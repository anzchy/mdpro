//! mdpro-owned macOS admission and forwarding (ADR-0166).

mod codec;
mod connector;
mod macos;
mod receiver;

pub use codec::{
    decode, encode, encode_with_cwd, read_frame, read_request, ForwardRequest, WireError,
    MAX_FRAME_BYTES,
};
pub use macos::{admit, validate_root, validate_socket_path, Admission, Namespace, Owner};
pub use receiver::{ForwardingHandle, ForwardingServer, MAX_PENDING};
