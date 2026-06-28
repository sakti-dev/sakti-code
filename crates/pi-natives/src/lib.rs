use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct BlockRangeOptions {
	/// Source code to inspect.
	pub code: String,
	/// Language alias (e.g. "rust", "typescript"); overrides path inference.
	pub lang: Option<String>,
	/// File path used to infer language by extension when `lang` is None.
	pub path: Option<String>,
	/// 1-indexed source line the block must begin on.
	pub line: u32,
}

#[napi(object)]
pub struct BlockRange {
	/// 1-indexed inclusive first line of the resolved block.
	pub start_line: u32,
	/// 1-indexed inclusive last line of the resolved block.
	pub end_line: u32,
}

/// Find the outermost named tree-sitter node that begins on `options.line`.
/// Returns its 1-indexed inclusive line span, or null when the language is
/// unrecognized, the line is blank/out-of-range, no node begins there, or the
/// resolved subtree contains a syntax error.
#[napi]
pub fn block_range_at(options: BlockRangeOptions) -> Result<Option<BlockRange>> {
	pi_ast::block::block_range_at(pi_ast::block::BlockRangeOptions {
		code: options.code,
		lang: options.lang,
		path: options.path,
		line: options.line,
	})
	.map(|range| range.map(|r| BlockRange { start_line: r.start_line, end_line: r.end_line }))
	.map_err(|e| Error::from_reason(e.to_string()))
}
