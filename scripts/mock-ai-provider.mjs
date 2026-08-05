/**
 * Mock OpenAI-compatible provider for testing the AI agent loop without a real
 * API key. Behavior: on the first turn it calls the list_nodes tool; once a
 * tool result is present it streams a short text answer.
 * Listens on http://127.0.0.1:5599/v1
 */
import { createServer } from 'node:http';

const PORT = 5599;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-model-1' }, { id: 'mock-model-2' }] }));
    return;
  }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    const messages = parsed.messages ?? [];
    const hasToolResult = messages.some((m) => m.role === 'tool');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const id = 'chatcmpl-mock';

    if (/dangerous/i.test(lastUser) && !hasToolResult) {
      // Ask for a dangerous tool to test the approval flow.
      sse(res, { id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_danger', function: { name: 'run_command', arguments: JSON.stringify({ scope: { kind: 'app', id: process.env.MOCK_APP_ID ?? 'unknown' }, command: 'echo hello-from-mock' }) } }] }, finish_reason: null }] });
      sse(res, { id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else if (!hasToolResult) {
      // Normal flow: stream some text, then call list_nodes.
      sse(res, { id, choices: [{ index: 0, delta: { content: 'Let me check your infrastructure. ' }, finish_reason: null }] });
      sse(res, { id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_nodes', arguments: '{}' } }] }, finish_reason: null }] });
      sse(res, { id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      const toolContent = messages.filter((m) => m.role === 'tool').map((m) => m.content).join(' ');
      const nodeCount = (toolContent.match(/"name"/g) ?? []).length;
      const text = `You have ${nodeCount >= 1 ? 'at least one node' : 'no nodes'} connected. All tools working!`;
      for (const word of text.split(' ')) {
        sse(res, { id, choices: [{ index: 0, delta: { content: word + ' ' }, finish_reason: null }] });
      }
      sse(res, { id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 13 } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, '127.0.0.1', () => console.log(`mock provider on http://127.0.0.1:${PORT}/v1`));
