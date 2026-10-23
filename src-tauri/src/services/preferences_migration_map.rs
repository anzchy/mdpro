//! The host-specific v1 → v2 default map used by the guarded migration.
use super::MappedDefault;

/// Every stored v1 default that changes on macOS. The old stored Image value
/// is `Cmd+Ctrl+I` on every host, even where its applied value was suppressed.
#[cfg(target_os = "macos")]
pub(super) const V1_TO_V2_DEFAULTS: &[MappedDefault] = &[
    MappedDefault {
        field: "fileOpenQuickly",
        from: "Cmd+Shift+O",
        to: "<unassigned>",
    },
    MappedDefault {
        field: "editDeleteWord",
        from: "Cmd+Shift+D",
        to: "<unassigned>",
    },
    MappedDefault {
        field: "editJumpToTop",
        from: "Cmd+Up",
        to: "<system>",
    },
    MappedDefault {
        field: "editJumpToBottom",
        from: "Cmd+Down",
        to: "<system>",
    },
    MappedDefault {
        field: "paragraphParagraph",
        from: "Cmd+0",
        to: "Cmd+Shift+0",
    },
    MappedDefault {
        field: "paragraphIncreaseHeading",
        from: "Cmd+=",
        to: "Cmd+Option+]",
    },
    MappedDefault {
        field: "paragraphDecreaseHeading",
        from: "Cmd+-",
        to: "Cmd+Option+[",
    },
    MappedDefault {
        field: "paragraphTable",
        from: "Cmd+Option+T",
        to: "Cmd+Shift+T",
    },
    MappedDefault {
        field: "paragraphMathBlock",
        from: "Cmd+Option+B",
        to: "Cmd+Option+Shift+M",
    },
    MappedDefault {
        field: "paragraphQuote",
        from: "Cmd+Option+Q",
        to: "Cmd+Shift+B",
    },
    MappedDefault {
        field: "formatStrike",
        from: "Ctrl+Shift+`",
        to: "Cmd+Shift+X",
    },
    MappedDefault {
        field: "formatImage",
        from: "Cmd+Ctrl+I",
        to: "Cmd+Shift+I",
    },
    MappedDefault {
        field: "formatHighlight",
        from: "Cmd+Shift+H",
        to: "Cmd+Shift+M",
    },
    MappedDefault {
        field: "viewToggleFullscreen",
        from: "Cmd+Option+F",
        to: "<system>",
    },
    MappedDefault {
        field: "viewSwitchDocuments",
        from: "Cmd+`",
        to: "Ctrl+Tab",
    },
];

/// Off-Mac defaults follow the same stored v1 values and the platform's v2
/// command table. Linux and Windows use the same v2 defaults.
#[cfg(not(target_os = "macos"))]
pub(super) const V1_TO_V2_DEFAULTS: &[MappedDefault] = &[
    MappedDefault {
        field: "fileOpenQuickly",
        from: "Cmd+Shift+O",
        to: "<unassigned>",
    },
    MappedDefault {
        field: "editDeleteWord",
        from: "Cmd+Shift+D",
        to: "<unassigned>",
    },
    MappedDefault {
        field: "editJumpToTop",
        from: "Cmd+Up",
        to: "<system>",
    },
    MappedDefault {
        field: "editJumpToBottom",
        from: "Cmd+Down",
        to: "<system>",
    },
    MappedDefault {
        field: "paragraphParagraph",
        from: "Cmd+0",
        to: "Cmd+Shift+0",
    },
    MappedDefault {
        field: "paragraphIncreaseHeading",
        from: "Cmd+=",
        to: "Cmd+Option+]",
    },
    MappedDefault {
        field: "paragraphDecreaseHeading",
        from: "Cmd+-",
        to: "Cmd+Option+[",
    },
    MappedDefault {
        field: "paragraphTable",
        from: "Cmd+Option+T",
        to: "Cmd+Shift+T",
    },
    MappedDefault {
        field: "paragraphCodeFences",
        from: "Cmd+Option+C",
        to: "Cmd+Shift+K",
    },
    MappedDefault {
        field: "paragraphMathBlock",
        from: "Cmd+Option+B",
        to: "Cmd+Option+Shift+M",
    },
    MappedDefault {
        field: "paragraphQuote",
        from: "Cmd+Option+Q",
        to: "Cmd+Shift+Q",
    },
    MappedDefault {
        field: "paragraphOrderedList",
        from: "Cmd+Option+O",
        to: "Cmd+Shift+[",
    },
    MappedDefault {
        field: "paragraphUnorderedList",
        from: "Cmd+Option+U",
        to: "Cmd+Shift+]",
    },
    MappedDefault {
        field: "formatStrike",
        from: "Ctrl+Shift+`",
        to: "Cmd+Shift+X",
    },
    MappedDefault {
        field: "formatImage",
        from: "Cmd+Ctrl+I",
        to: "Cmd+Shift+I",
    },
    MappedDefault {
        field: "formatHighlight",
        from: "Cmd+Shift+H",
        to: "Cmd+Shift+M",
    },
    MappedDefault {
        field: "viewSource",
        from: "Ctrl+2",
        to: "<unassigned>",
    },
    MappedDefault {
        field: "viewWysiwyg",
        from: "Ctrl+4",
        to: "<unassigned>",
    },
    MappedDefault {
        field: "viewToggleFullscreen",
        from: "Cmd+Option+F",
        to: "F11",
    },
    MappedDefault {
        field: "viewSwitchDocuments",
        from: "Cmd+`",
        to: "Cmd+Tab",
    },
];
