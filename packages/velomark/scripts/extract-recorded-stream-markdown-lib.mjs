export function extractMarkdownFromRecordedChunks(chunks) {
  let markdown = "";

  for (const chunk of chunks) {
    const lines = String(chunk)
      .split("\n")
      .filter((line) => line.startsWith("data: "));

    for (const line of lines) {
      const payload = JSON.parse(line.slice(6));
      if (payload.type === "text-delta" && typeof payload.delta === "string") {
        markdown += payload.delta;
      }
    }
  }

  return markdown;
}

export function extractMarkdownFromRecordedFixture(fixture) {
  const entries = Array.isArray(fixture) ? fixture : [];
  return entries
    .map((entry) => extractMarkdownFromRecordedChunks(entry?.chunks ?? []))
    .filter(Boolean)
    .join("\n\n");
}
