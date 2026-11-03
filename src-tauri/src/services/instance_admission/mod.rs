//! mdpro-owned macOS admission and forwarding (ADR-0166).

mod codec;
mod connector;
mod legacy_peer;
mod legacy_route;
mod lock;
mod macos;
mod public_alias;
mod receiver;

pub use codec::{
    decode, encode, encode_with_cwd, read_frame, read_request, ForwardRequest, WireError,
    MAX_FRAME_BYTES,
};
pub use legacy_peer::{
    forward_if_qualified, qualify_connected_peer, running_image_allowed, CompatibleImage,
    PeerIdentity, LEGACY_COMPATIBLE_IMAGES,
};
pub use macos::{admit, validate_root, validate_socket_path, Admission, Namespace, Owner};
#[cfg(debug_assertions)]
pub use macos::{admit_with_alias_creation_hook_for_test, admit_with_public_alias_for_test};
pub use receiver::{ForwardingHandle, ForwardingServer, MAX_PENDING};
