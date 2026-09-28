//! mdpro-mcp: MCP Server Binary for mdpro
//!
//! This binary acts as an MCP (Model Context Protocol) server that
//! Claude Code, Codex CLI, and Gemini CLI can spawn to interact with
//! mdpro documents.
//!
//! Architecture:
//! - MCP Client spawns this binary via stdio
//! - This binary reads server.port and server.token from the platform data
//!   dir, `dirs::data_dir()/mdpro/` (macOS: `~/Library/Application Support/mdpro/`),
//!   the same directory `http_server::config_dir()` writes them to
//! - Forwards MCP tool calls to mdpro's internal HTTP API through
//!   `conn::Conn`, which re-reads port and token when the app restarts its
//!   server (ADR-0040): a GET is retried once, a POST is never replayed
//! - Returns results back to the MCP client

use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::ErrorData;
use rmcp::model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo};
use rmcp::schemars;
use rmcp::transport::stdio;
use rmcp::{tool, tool_handler, tool_router, ServerHandler, ServiceExt};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[path = "mdpro_mcp/conn.rs"]
mod conn;

use conn::Conn;

/// Document info returned from list endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DocumentInfo {
    id: String,
    title: String,
    path: Option<String>,
    is_dirty: bool,
}

/// Document content returned from read endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DocumentContent {
    content: String,
    cursor: usize,
}

/// Write result from update endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WriteResult {
    success: bool,
}

/// Insert result from insert endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InsertResult {
    success: bool,
    new_cursor: usize,
}

/// Parameters for read_document tool
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
struct ReadDocumentParams {
    /// Document ID from get_open_documents
    id: String,
}

/// Parameters for write_document tool
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
struct WriteDocumentParams {
    /// Document ID to write to
    id: String,
    /// New content to replace the document with
    content: String,
}

/// Parameters for insert_content tool
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
struct InsertContentParams {
    /// Document ID to insert into
    id: String,
    /// Text to insert
    text: String,
    /// Position: 'cursor', 'start', 'end', or a character offset number
    position: String,
}

/// MCP Server for mdpro
#[derive(Clone)]
pub struct MdproMcpServer {
    conn: Arc<Conn>,
    tool_router: ToolRouter<Self>,
}

impl MdproMcpServer {
    fn new(conn: Conn) -> Self {
        Self {
            conn: Arc::new(conn),
            tool_router: Self::tool_router(),
        }
    }
}

/// Tool implementations
#[tool_router(router = tool_router)]
impl MdproMcpServer {
    /// Get list of all documents currently open in mdpro.
    /// Returns document IDs, titles, file paths, and modification status.
    #[tool(
        name = "get_open_documents",
        description = "Get list of all documents currently open in mdpro"
    )]
    async fn get_open_documents(&self) -> Result<CallToolResult, ErrorData> {
        let docs: Vec<DocumentInfo> = self.conn.get("/api/documents").await?;
        let json = serde_json::to_string_pretty(&docs)
            .map_err(|e| ErrorData::internal_error(format!("Failed to serialize: {}", e), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    /// Read the content of a specific document by its ID.
    /// Use get_open_documents first to find available document IDs.
    #[tool(
        name = "read_document",
        description = "Read the content of a specific document by its ID"
    )]
    async fn read_document(
        &self,
        params: Parameters<ReadDocumentParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let content: DocumentContent = self
            .conn
            .get(&format!("/api/documents/{}", params.0.id))
            .await?;
        Ok(CallToolResult::success(vec![Content::text(
            content.content,
        )]))
    }

    /// Replace the entire content of a document.
    /// This is a destructive operation. If mdpro is not focused, user confirmation is required.
    #[tool(
        name = "write_document",
        description = "Replace the entire content of a document (destructive - may require confirmation)"
    )]
    async fn write_document(
        &self,
        params: Parameters<WriteDocumentParams>,
    ) -> Result<CallToolResult, ErrorData> {
        #[derive(Serialize)]
        struct WriteRequest {
            content: String,
        }

        let result: WriteResult = self
            .conn
            .post(
                &format!("/api/documents/{}", params.0.id),
                &WriteRequest {
                    content: params.0.content,
                },
            )
            .await?;

        if result.success {
            Ok(CallToolResult::success(vec![Content::text(
                "Document updated successfully",
            )]))
        } else {
            Ok(CallToolResult::success(vec![Content::text(
                "Write operation failed",
            )]))
        }
    }

    /// Insert text at a specific position in the document.
    /// Less destructive than write_document as it preserves existing content.
    #[tool(
        name = "insert_content",
        description = "Insert text at a specific position in the document"
    )]
    async fn insert_content(
        &self,
        params: Parameters<InsertContentParams>,
    ) -> Result<CallToolResult, ErrorData> {
        #[derive(Serialize)]
        struct InsertRequest {
            text: String,
            position: serde_json::Value,
        }

        // Parse position - could be "cursor", "start", "end", or a number
        let position_value = if let Ok(num) = params.0.position.parse::<usize>() {
            serde_json::Value::Number(num.into())
        } else {
            serde_json::Value::String(params.0.position)
        };

        let result: InsertResult = self
            .conn
            .post(
                &format!("/api/documents/{}/insert", params.0.id),
                &InsertRequest {
                    text: params.0.text,
                    position: position_value,
                },
            )
            .await?;

        if result.success {
            Ok(CallToolResult::success(vec![Content::text(format!(
                "Text inserted successfully. New cursor position: {}",
                result.new_cursor
            ))]))
        } else {
            Ok(CallToolResult::success(vec![Content::text(
                "Insert operation failed",
            )]))
        }
    }
}

/// Server handler implementation
#[tool_handler(router = self.tool_router)]
impl ServerHandler for MdproMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: Default::default(),
            server_info: Implementation {
                name: "mdpro".into(),
                title: Some("mdpro MCP Server".into()),
                version: env!("CARGO_PKG_VERSION").into(),
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "MCP server for mdpro markdown editor. \
                 Use get_open_documents to list available documents, \
                 read_document to read content, and write_document or \
                 insert_content to modify documents."
                    .into(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
        }
    }
}

#[tokio::main]
async fn main() {
    // Load config from the platform data dir (the only place it is named)
    let conn = match dirs::data_dir()
        .ok_or_else(|| "Could not find data directory".to_string())
        .and_then(|data| Conn::load_from(&data.join("mdpro")))
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    // Verify connection to mdpro
    if let Err(e) = conn.get::<serde_json::Value>("/api/status").await {
        eprintln!("Error: {}", e.message);
        eprintln!("Make sure mdpro is running.");
        std::process::exit(1);
    }

    // Create and run server
    let server = MdproMcpServer::new(conn);

    match server.serve(stdio()).await {
        Ok(service) => {
            if let Err(e) = service.waiting().await {
                eprintln!("Server error: {}", e);
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("Failed to start server: {}", e);
            std::process::exit(1);
        }
    }
}
