//! Compiler diagnostics.

use crate::span::line_col;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Note,
}

impl Severity {
    pub fn label(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Note => "note",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub lo: usize,
    pub hi: usize,
}

impl Diagnostic {
    pub fn error(message: impl Into<String>, lo: usize, hi: usize) -> Self {
        Diagnostic {
            severity: Severity::Error,
            message: message.into(),
            lo,
            hi,
        }
    }

    pub fn warning(message: impl Into<String>, lo: usize, hi: usize) -> Self {
        Diagnostic {
            severity: Severity::Warning,
            message: message.into(),
            lo,
            hi,
        }
    }

    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }

    /// Render as `file:line:col: severity: message`.
    pub fn render(&self, src: &str, filename: &str) -> String {
        let (line, col) = line_col(src, self.lo);
        format!(
            "{}:{}:{}: {}: {}",
            filename,
            line,
            col,
            self.severity.label(),
            self.message
        )
    }
}
