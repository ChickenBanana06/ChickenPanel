/** Minimal Server-Sent Events parser over a fetch body stream. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const flush = (): { event: string; data: string } | null => {
    if (dataLines.length === 0) return null;
    const out = { event: eventName, data: dataLines.join('\n') };
    eventName = 'message';
    dataLines = [];
    return out;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line === '') {
          const evt = flush();
          if (evt) yield evt;
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
        // comments (:) and other fields ignored
      }
    }
    const evt = flush();
    if (evt) yield evt;
  } finally {
    reader.releaseLock();
  }
}
