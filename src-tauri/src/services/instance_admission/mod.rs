//! mdpro-owned macOS admission and forwarding (ADR-0166).

mod macos;

pub use macos::{admit, validate_root, validate_socket_path, Admission, Namespace, Owner};
