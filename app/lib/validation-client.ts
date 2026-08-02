type EventCB = (event: { type: string; [key: string]: any }) => void;

export async function streamResponseEvents(
  response: Response,
  onEvent: EventCB
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Stream non disponible");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        onEvent(event);
      } catch {
        // ignore malformed lines
      }
    }
  }
}

export async function fetchValidationChunk(
  endpoint: string,
  cookieText: string,
  start: number,
  limit: number,
  signal: AbortSignal,
  onEvent: EventCB
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookies: cookieText, start, limit }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Erreur serveur: ${response.status}`);
  }

  await streamResponseEvents(response, onEvent);
}
