//! mdpro-mcp: MCP Server Binary for mdpro
//!
//! This binary acts as an MCP (Model Context Protocol) server that
//! Claude Code, Codex CLI, and Gemini CLI can spawn to interact with
//! mdpro documents.
//!
//! Architecture:
//! - MCP Client spawns this binary via stdio
//! - This binary reads ~/.mdpro/server.port and ~/.mdpro/server.token
//! - Forwards MCP tool calls to mdpro's internal HTTP API
//! - Returns results back to the MCP client

use std::fs;
use std::sync::Arc;

use reqwest::Client;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::ErrorData;
use rmcp::model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo};
use rmcp::schemars;
use rmcp::transport::stdio;
use rmcp::{tool, tool_handler, tool_router, ServerHandler, ServiceExt};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Server configuration read from the platform data directory.
struct ServerConfig {
    port: u16,
    token: String,
}

impl ServerConfig {
    /// Read config from platform data dir (e.g. ~/Library/Application Support/mdpro)
    fn load() -> Result<Self, String> {
        let data = dirs::data_dir().ok_or("Could not find data directory")?;
        let config_dir = data.join("mdpro");

        let port_path = config_dir.join("server.port");
        let token_path = config_dir.join("server.token");

        if !port_path.exists() {
            return Err(
                "mdpro not running: server.port not found. Please start mdpro first.".into(),
            );
        }
        if !token_path.exists() {
            return Err(
                "mdpro not running: server.token not found. Please start mdpro first.".into(),
            );
        }

        let port_str = fs::read_to_string(&port_path)
            .map_err(|e| format!("Failed to read server.port: {}", e))?;
        let port: u16 = port_str
            .trim()
            .parse()
            .map_err(|e| format!("Invalid port number: {}", e))?;

        let token = fs::read_to_string(&token_path)
            .map_err(|e| format!("Failed to read server.token: {}", e))?
            .trim()
            .to_string();

        Ok(Self { port, token })
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

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
    config: Arc<ServerConfig>,
    client: Client,
    tool_router: ToolRouter<Self>,
}

impl MdproMcpServer {
    fn new(config: ServerConfig) -> Self {
        Self {
            config: Arc::new(config),
            client: Client::new(),
            tool_router: Self::tool_router(),
        }
    }

    /// Make an authenticated GET request to mdpro HTTP API
    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, ErrorData> {
        let url = format!("{}{}", self.config.base_url(), path);
        let response = self
            .client
            .get(&url)
            .header("X-MDPRO-Token", &self.config.token)
            .send()
            .await
            .map_err(|e| ErrorData::internal_error(format!("HTTP request failed: {}", e), None))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(ErrorData::internal_error(
                format!("HTTP {}: {}", status, text),
                None,
            ));
        }

        response.json().await.map_err(|e| {
            ErrorData::internal_error(format!("Failed to parse response: {}", e), None)
        })
    }

    /// Make an authenticated POST request to mdpro HTTP API
    async fn post<T: for<'de> Deserialize<'de>, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ErrorData> {
        let url = format!("{}{}", self.config.base_url(), path);
        let response = self
            .client
            .post(&url)
            .header("X-MDPRO-Token", &self.config.token)
            .json(body)
            .send()
            .await
            .map_err(|e| ErrorData::internal_error(format!("HTTP request failed: {}", e), None))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(ErrorData::internal_error(
                format!("HTTP {}: {}", status, text),
                None,
            ));
        }

        response.json().await.map_err(|e| {
            ErrorData::internal_error(format!("Failed to parse response: {}", e), None)
        })
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
        let docs: Vec<DocumentInfo> = self.get("/api/documents").await?;
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
        let content: DocumentContent = self.get(&format!("/api/documents/{}", params.0.id)).await?;
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
    // Load config
    let config = match ServerConfig::load() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    // Verify connection to mdpro
    let client = Client::new();
    let check_url = format!("http://127.0.0.1:{}/api/status", config.port);
    match client
        .get(&check_url)
        .header("X-MDPRO-Token", &config.token)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            // Connected successfully
        }
        Ok(response) => {
            eprintln!("Error: mdpro returned status {}", response.status());
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("Error: Could not connect to mdpro: {}", e);
            eprintln!("Make sure mdpro is running.");
            std::process::exit(1);
        }
    }

    // Create and run server
    let server = MdproMcpServer::new(config);

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
