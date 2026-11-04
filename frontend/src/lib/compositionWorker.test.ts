import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('bundled bounding-box-only worker', () => {
  it('processes flat and textured real pixels with bounded candidate grouping', () => {
    const output: unknown[] = []
    const root = new URL('../../public/models/composition/', import.meta.url)
    const context = createContext({ postMessage: (message: unknown) => output.push(message) })
    context.self = context
    context.importScripts = (...names: string[]) => { for (const name of names) runInContext(readFileSync(new URL(name, root), 'utf8'), context) }
    runInContext(readFileSync(new URL('detector.worker.js', root), 'utf8'), context)
    runInContext('self.onmessage({ data: { data: new Uint8ClampedArray(128*128*4), width: 128, height: 128 } })', context, { timeout: 3000 })
    expect(output[0]).toEqual({ boxes: [] })
    runInContext(`const data=new Uint8ClampedArray(128*128*4);let seed=417;for(let i=0;i<128*128;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i*4]=seed%256;data[i*4+1]=seed>>>8&255;data[i*4+2]=seed>>>16&255;data[i*4+3]=255}self.onmessage({data:{data,width:128,height:128}})`, context, { timeout: 3000 })
    expect(output[1]).toHaveProperty('boxes')
    expect(JSON.stringify(output)).not.toMatch(/landmark|embedding|template/)
  })
})
