//! Pure window-geometry rules shared by `create_window` and
//! `save_window_geometry` (ADR-0031 step 2, WI-3).
//!
//! Purpose: decide what rectangle a window opens with, and refuse a geometry
//! the frontend or a hand-edited `config.json` should never have produced.
//! Nothing here touches Tauri, the filesystem or the preferences store, so the
//! rust lane can call it directly — the builder call that consumes it needs a
//! live app handle and a window server, and is the only part left uncovered.
//!
//! Key decisions:
//! - **Reference frame**: every `WindowGeometry` here is (outer position, inner
//!   size) in **logical points**. See the D-c note in
//!   `src/hooks/useWindowCloseGuard.ts` and the `WindowGeometry` doc comment in
//!   `models/preferences.rs`.
//! - **`sanitize_geometry` validates; it never repairs.** Quietly clamping an
//!   absurd input to something plausible would hide the frontend bug that
//!   produced it.
//! - **`clamp_geometry` mirrors `clampToWorkArea` in
//!   `src/utils/windowGeometry.ts`.** The same rule stated twice is a drift
//!   hazard, so the two test domains are deliberately shared; a divergence
//!   shows up as one lane red and the other green.
//! - **All clamp arithmetic is `f64` with saturating casts back**, because
//!   `get_stored_geometry` hands `create_window` a record straight off disk
//!   with no guard in front of it, and a debug-profile overflow inside a
//!   `#[tauri::command]` is what rule 60 forbids.

use crate::models::WindowGeometry;
use serde::Serialize;

/// Largest `width`/`height` accepted from the frontend or from `config.json`,
/// matching the practical limit of platform window coordinates.
pub(crate) const MAX_WINDOW_DIMENSION: u32 = 32_767;
/// Bounds for `x`/`y`, same range, signed.
pub(crate) const MAX_WINDOW_COORDINATE: i32 = 32_767;
pub(crate) const MIN_WINDOW_COORDINATE: i32 = -32_768;
/// Size of a window with no stored record. Mirrors `main.rs`.
pub(crate) const DEFAULT_WINDOW_SIZE: (f64, f64) = (1200.0, 800.0);
/// Floor every window is held above. Mirrors `min_inner_size` below,
/// `main.rs:99` and `DEFAULT_MIN_WINDOW_SIZE` in `src/utils/windowGeometry.ts`.
pub(crate) const MIN_WINDOW_SIZE: (f64, f64) = (600.0, 400.0);
/// Used only when the platform reports no monitor at all. Spanning the whole
/// representable coordinate range makes the clamp a no-op apart from the size
/// floor, so an undetectable monitor never drags a window off a negative-origin
/// display it was legitimately on.
pub(crate) const FALLBACK_WORK_AREA: WorkArea = WorkArea {
    x: MIN_WINDOW_COORDINATE as f64,
    y: MIN_WINDOW_COORDINATE as f64,
    width: (MAX_WINDOW_COORDINATE as f64) - (MIN_WINDOW_COORDINATE as f64),
    height: (MAX_WINDOW_COORDINATE as f64) - (MIN_WINDOW_COORDINATE as f64),
};

/// A monitor's usable area in **logical points**, origin included.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What `create_window` should hand the builder.
///
/// `position` is `Option` on purpose: `create_window`'s no-stored-record branch
/// calls `inner_size` and **no** `position`, which is what lets the window
/// server cascade successive new windows. A concrete `(0.0, 0.0)` would stack
/// them all at the top-left — a user-visible change an extraction has no
/// business making. WI3-P asserts the `None`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ResolvedGeometry {
    pub position: Option<(f64, f64)>,
    pub size: (f64, f64),
}

/// Why a `WindowGeometry` crossing the IPC boundary was refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) enum GeometryError {
    /// `width` or `height` is zero or above [`MAX_WINDOW_DIMENSION`].
    InvalidDimension { field: &'static str, value: u32 },
    /// `x` or `y` is outside the representable window-coordinate range.
    InvalidCoordinate { field: &'static str, value: i32 },
}

impl std::fmt::Display for GeometryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GeometryError::InvalidDimension { field, value } => {
                write!(f, "invalid window geometry: {field} = {value}")
            }
            GeometryError::InvalidCoordinate { field, value } => {
                write!(f, "invalid window geometry: {field} = {value}")
            }
        }
    }
}

/// Validate a geometry crossing the IPC boundary. **Validates, never repairs**:
/// every accepted geometry is returned byte-for-byte unchanged, so an absurd
/// value surfaces the frontend bug that produced it instead of being quietly
/// rounded into something plausible.
pub(crate) fn sanitize_geometry(geometry: WindowGeometry) -> Result<WindowGeometry, GeometryError> {
    for (field, value) in [("width", geometry.width), ("height", geometry.height)] {
        if value == 0 || value > MAX_WINDOW_DIMENSION {
            return Err(GeometryError::InvalidDimension { field, value });
        }
    }
    for (field, value) in [("x", geometry.x), ("y", geometry.y)] {
        if !(MIN_WINDOW_COORDINATE..=MAX_WINDOW_COORDINATE).contains(&value) {
            return Err(GeometryError::InvalidCoordinate { field, value });
        }
    }
    Ok(geometry)
}

/// Project a stored geometry onto the rectangles that are at least `min` and,
/// where one exists, fully inside `work_area`. The Rust mirror of
/// `clampToWorkArea` in `src/utils/windowGeometry.ts`; the two are the same
/// rule stated twice and their test domains are deliberately shared.
///
/// All arithmetic is in `f64` and every cast back is saturating, so a value
/// already on disk — which `get_stored_geometry` reads with no guard in front
/// of it — cannot overflow-panic inside a `#[tauri::command]`.
pub(crate) fn clamp_geometry(
    geometry: WindowGeometry,
    work_area: WorkArea,
    min: (f64, f64),
) -> WindowGeometry {
    // The floor wins over the work area: a rectangle below `min_inner_size` is
    // one the OS would reject outright, so containment is an invariant *with a
    // precondition* — it holds whenever a rectangle of at least `min` fits.
    let width = f64::from(geometry.width).min(work_area.width).max(min.0);
    let height = f64::from(geometry.height).min(work_area.height).max(min.1);

    // When the floor made the rectangle wider than the work area there is no
    // in-bounds position; pin it to the origin rather than pushing it out the
    // other side.
    let max_x = (work_area.x + work_area.width - width).max(work_area.x);
    let max_y = (work_area.y + work_area.height - height).max(work_area.y);

    WindowGeometry {
        x: f64::from(geometry.x).max(work_area.x).min(max_x).round() as i32,
        y: f64::from(geometry.y).max(work_area.y).min(max_y).round() as i32,
        width: width.round() as u32,
        height: height.round() as u32,
        last_accessed: geometry.last_accessed,
    }
}

/// Decide what geometry a new window opens with.
///
/// The clamp lives here rather than at the builder because every `windowStates`
/// entry written before WI-3 holds 2x-inflated physical pixels: a write-path
/// fix alone would leave every existing record opening a 2400x1600 window on
/// the first launch after the upgrade.
pub(crate) fn resolve_window_geometry(
    stored: Option<WindowGeometry>,
    work_area: WorkArea,
    min: (f64, f64),
) -> ResolvedGeometry {
    match stored {
        Some(geo) => {
            let clamped = clamp_geometry(geo, work_area, min);
            ResolvedGeometry {
                position: Some((f64::from(clamped.x), f64::from(clamped.y))),
                size: (f64::from(clamped.width), f64::from(clamped.height)),
            }
        }
        None => ResolvedGeometry {
            // No position: the window server cascades new windows, and taking
            // that over would stack them all at the top-left.
            position: None,
            // A 1200x800 default on a small display is the same defect as an
            // inflated stored record, so the default is fitted too.
            size: (
                DEFAULT_WINDOW_SIZE.0.min(work_area.width).max(min.0),
                DEFAULT_WINDOW_SIZE.1.min(work_area.height).max(min.1),
            ),
        },
    }
}
