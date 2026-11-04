import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDeps,
  fetchSummary,
  postChatTemplate,
  postDownload,
  postGet,
  postInstall,
  postLaunch,
  postProviderDelete,
  postRegister,
  postSave,
  postStop,
  postUnregister,
  readGetStream,
  readLaunchStream,
  readNdjsonLines,
  routeExists,
} from '../src/api/routes.ts'

// jsonResponse builds a JSON Response the wrappers parse. A non-OK status
// with an error field is the route's failure shape.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// streamFromChunks yields the given text chunks one read at a time, so a
// chunk boundary falls where the test puts it (mid-line, mid-JSON, or on a
// newline).
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

// streamResponse wraps the chunk stream in a 200 Response.
function streamResponse(chunks: string[]): Response {
  return new Response(streamFromChunks(chunks), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

// nonStreamJsonResponse builds a JSON Response whose body is null, the host
// that cannot stream branch the readers fall back to.
function nonStreamJsonResponse(body: unknown): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'body', { value: null })
  return response
}

// stubFetch installs a global fetch that records each call and answers with
// the given factory, so a test asserts on the request the wrapper sent.
function stubFetch(answer: (url: string, init?: RequestInit) => Response): void {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return answer(url, init)
    }),
  )
  ;(stubFetch as { calls?: { url: string; init?: RequestInit }[] }).calls = calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchSummary and fetchDeps (the GET routes)', () => {
  it('sends the engine and config query params', async () => {
    stubFetch(() => jsonResponse(200, { engineId: 'ninfer' }))
    await fetchSummary({ engine: 'ninfer', config: { model: 'qwen3' } })
    const call = (stubFetch as { calls?: { url: string }[] }).calls?.[0]
    expect(call?.url).toBe(
      '/local-infer/summary?engine=ninfer&config=' + encodeURIComponent('{"model":"qwen3"}'),
    )
  })

  it('omits the query string when the query is absent', async () => {
    stubFetch(() => jsonResponse(200, { engineId: 'ninfer' }))
    await fetchDeps()
    const call = (stubFetch as { calls?: { url: string }[] }).calls?.[0]
    expect(call?.url).toBe('/local-infer/deps')
  })

  it('throws with the body error field on a non-OK response', async () => {
    stubFetch(() => jsonResponse(500, { error: 'the host broke' }))
    await expect(fetchSummary()).rejects.toThrow('the host broke')
  })

  it('falls back to the HTTP status when the body has no error field', async () => {
    stubFetch(() => jsonResponse(503, {}))
    await expect(fetchDeps()).rejects.toThrow('HTTP 503')
  })
})

describe('the POST JSON routes', () => {
  it('posts the JSON body with the content-type header', async () => {
    stubFetch(() => jsonResponse(200, { stopped: true }))
    const result = await postStop({ engine: 'ninfer', providerId: 'p1' })
    expect(result).toEqual({ stopped: true })
    const call = (stubFetch as { calls?: { url: string; init?: RequestInit }[] }).calls?.[0]
    expect(call?.url).toBe('/local-infer/stop')
    expect(call?.init?.method).toBe('POST')
    expect(JSON.parse(String(call?.init?.body))).toEqual({ engine: 'ninfer', providerId: 'p1' })
    expect((call?.init?.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    )
  })

  it('throws with the body error field on a non-OK POST', async () => {
    stubFetch(() => jsonResponse(409, { error: 'the trust gate is off' }))
    await expect(postInstall({ engine: 'ninfer' })).rejects.toThrow('the trust gate is off')
  })

  it('answers the save route with the fresh summary', async () => {
    stubFetch(() => jsonResponse(200, { engineId: 'ninfer', registered: false }))
    const summary = await postSave({ engine: 'ninfer', settingsOnly: true })
    expect(summary.engineId).toBe('ninfer')
  })

  it('answers the register route with the model entry', async () => {
    stubFetch(() =>
      jsonResponse(200, { ok: true, entry: { modelId: 'm1', providerId: 'p1' } }),
    )
    const result = await postRegister({ engine: 'ninfer' })
    expect(result.ok).toBe(true)
    expect(result.entry?.modelId).toBe('m1')
  })

  it('answers the unregister route with the removal flag', async () => {
    stubFetch(() => jsonResponse(200, { removed: true }))
    await expect(postUnregister({ engine: 'ninfer' })).resolves.toEqual({ removed: true })
  })

  it('answers the download and chat-template routes with the download result', async () => {
    stubFetch(() => jsonResponse(200, { ok: true }))
    await expect(postDownload({ engine: 'ninfer', model: 'm1' })).resolves.toEqual({ ok: true })
    await expect(
      postChatTemplate({ engine: 'ninfer', template: 'org/repo' }),
    ).resolves.toEqual({ ok: true })
  })

  it('answers the provider-delete route with the fresh summary', async () => {
    stubFetch(() => jsonResponse(200, { engineId: 'ninfer', providers: [] }))
    const summary = await postProviderDelete({ id: 'p1' })
    expect(summary.providers).toEqual([])
  })
})

describe('readNdjsonLines (the NDJSON line reader)', () => {
  it('parses a line split across chunk boundaries', async () => {
    const events: unknown[] = []
    await readNdjsonLines(streamFromChunks(['{"step":"pre', 'reqs"}\n']), (event) =>
      events.push(event),
    )
    expect(events).toEqual([{ step: 'prereqs' }])
  })

  it('completes a partial line on the next chunk', async () => {
    const events: unknown[] = []
    await readNdjsonLines(streamFromChunks(['{"a":1}', '\n{"b":2}\n']), (event) =>
      events.push(event),
    )
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('skips a line that is not JSON', async () => {
    const events: unknown[] = []
    await readNdjsonLines(streamFromChunks(['not json\n{"ok":true}\n']), (event) =>
      events.push(event),
    )
    expect(events).toEqual([{ ok: true }])
  })

  it('parses a final line without a trailing newline', async () => {
    const events: unknown[] = []
    await readNdjsonLines(
      streamFromChunks(['{"step":"build"}\n{"result":{"healthy":true}}']),
      (event) => events.push(event),
    )
    expect(events).toEqual([{ step: 'build' }, { result: { healthy: true } }])
  })

  it('skips a partial final line that is not JSON', async () => {
    const events: unknown[] = []
    await readNdjsonLines(streamFromChunks(['{"a":1}\n{"b":']), (event) => events.push(event))
    expect(events).toEqual([{ a: 1 }])
  })
})

describe('readLaunchStream (the launch route answer)', () => {
  it('returns the final result event and hands each step to onStep', async () => {
    const steps: string[] = []
    const response = streamResponse([
      '{"step":"prereqs"}\n{"step":"build"}\n',
      '{"result":{"healthy":true,"plan":{"port":11435}}}\n',
    ])
    const result = await readLaunchStream(response, (step) => steps.push(step))
    expect(steps).toEqual(['prereqs', 'build'])
    expect(result).toEqual({ healthy: true, plan: { port: 11435 } })
  })

  it('returns null when the stream ends without a result event', async () => {
    const response = streamResponse(['{"step":"prereqs"}\n'])
    await expect(readLaunchStream(response)).resolves.toBeNull()
  })

  it('throws with the body text on a non-OK response', async () => {
    const response = new Response('the host broke', { status: 500 })
    await expect(readLaunchStream(response)).rejects.toThrow('the host broke')
  })

  it('reads the whole body as the result when the host cannot stream', async () => {
    const response = nonStreamJsonResponse({ healthy: false, detail: 'no stream' })
    await expect(readLaunchStream(response)).resolves.toEqual({
      healthy: false,
      detail: 'no stream',
    })
  })

  it('forwards progress events to onProgress and returns the result', async () => {
    const steps: string[] = []
    const progress: unknown[] = []
    const response = streamResponse([
      '{"step":"prereqs"}\n{"progress":{"step":"Downloading x.safetensors","percent":12,"doneBytes":5200000000,"totalBytes":43500000000,"etaSeconds":611,"unit":"bytes"}}\n',
      '{"result":{"healthy":true}}\n',
    ])
    const result = await readLaunchStream(
      response,
      (step) => steps.push(step),
      (state) => progress.push(state),
    )
    expect(steps).toEqual(['prereqs'])
    expect(progress).toEqual([
      {
        step: 'Downloading x.safetensors',
        percent: 12,
        doneBytes: 5200000000,
        totalBytes: 43500000000,
        etaSeconds: 611,
        unit: 'bytes',
      },
    ])
    expect(result).toEqual({ healthy: true })
  })

  it('ignores progress events when no onProgress is given', async () => {
    const response = streamResponse([
      '{"progress":{"percent":12}}\n{"result":{"healthy":true}}\n',
    ])
    await expect(readLaunchStream(response)).resolves.toEqual({ healthy: true })
  })
})

describe('readGetStream (the get route answer)', () => {
  it('hands log events to onChunk and progress events to onProgress', async () => {
    const chunks: string[] = []
    const progress: unknown[] = []
    const response = streamResponse([
      '{"log":"line one\\n"}\n{"progress":{"step":"Downloading x.safetensors","percent":12,"doneBytes":5200000000,"totalBytes":43500000000,"etaSeconds":611,"unit":"bytes"}}\n',
      '{"log":"line two\\n"}\n',
    ])
    await readGetStream(response, (text) => chunks.push(text), (state) => progress.push(state))
    expect(chunks).toEqual(['line one\n', 'line two\n'])
    expect(progress).toEqual([
      {
        step: 'Downloading x.safetensors',
        percent: 12,
        doneBytes: 5200000000,
        totalBytes: 43500000000,
        etaSeconds: 611,
        unit: 'bytes',
      },
    ])
  })

  it('ignores progress events when no onProgress is given', async () => {
    const chunks: string[] = []
    const response = streamResponse(['{"progress":{"percent":12}}\n{"log":"line one\\n"}\n'])
    await readGetStream(response, (text) => chunks.push(text))
    expect(chunks).toEqual(['line one\n'])
  })

  it('throws with the body text on a non-OK response', async () => {
    const response = new Response('the build broke', { status: 400 })
    await expect(readGetStream(response, () => undefined)).rejects.toThrow('the build broke')
  })

  it('reads the whole body as one log chunk when the host cannot stream', async () => {
    const chunks: string[] = []
    const response = nonStreamJsonResponse('the whole body')
    await readGetStream(response, (text) => chunks.push(text))
    expect(chunks).toEqual(['"the whole body"'])
  })
})

describe('postLaunch and postGet (the streamed routes)', () => {
  it('streams the launch answer and returns the result event', async () => {
    stubFetch(() => streamResponse(['{"result":{"healthy":true}}\n']))
    const result = await postLaunch({ engine: 'ninfer' })
    expect(result).toEqual({ healthy: true })
  })

  it('appends each get log event through onChunk', async () => {
    stubFetch(() =>
      streamResponse(['{"log":"line one\\n"}\n', '{"log":"line two\\n"}\n']),
    )
    const chunks: string[] = []
    await postGet({ engine: 'ninfer' }, (text) => chunks.push(text))
    expect(chunks.join('')).toBe('line one\nline two\n')
  })

  it('hands get progress events through onProgress', async () => {
    stubFetch(() =>
      streamResponse([
        '{"progress":{"step":"Downloading x.safetensors","percent":12,"doneBytes":5200000000,"totalBytes":43500000000,"etaSeconds":611,"unit":"bytes"}}\n',
      ]),
    )
    const progress: unknown[] = []
    await postGet(
      { engine: 'ninfer' },
      () => undefined,
      undefined,
      (state) => progress.push(state),
    )
    expect(progress).toEqual([
      {
        step: 'Downloading x.safetensors',
        percent: 12,
        doneBytes: 5200000000,
        totalBytes: 43500000000,
        etaSeconds: 611,
        unit: 'bytes',
      },
    ])
  })
})

describe('routeExists (the bootstrap probe)', () => {
  it('reads any non-404 response as present', async () => {
    stubFetch(() => jsonResponse(200, { engineId: 'ninfer' }))
    await expect(routeExists()).resolves.toBe(true)
  })

  it('reads a 404 as absent', async () => {
    stubFetch(() => jsonResponse(404, {}))
    await expect(routeExists()).resolves.toBe(false)
  })

  it('reads a network failure as absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('the host is down')
      }),
    )
    await expect(routeExists()).resolves.toBe(false)
  })
})
