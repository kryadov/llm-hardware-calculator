declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type Bytes = Brand<number, 'Bytes'>
export type BytesPerSec = Brand<number, 'BytesPerSec'>
export type Flops = Brand<number, 'Flops'>
export type Seconds = Brand<number, 'Seconds'>
export type TokensPerSec = Brand<number, 'TokensPerSec'>
export type Usd = Brand<number, 'Usd'>
export type Watts = Brand<number, 'Watts'>

export const GIB = 1024 ** 3

export const bytes = (n: number) => n as Bytes
export const gib = (n: number) => (n * GIB) as Bytes
export const toGib = (b: Bytes) => (b as number) / GIB
export const bytesPerSec = (n: number) => n as BytesPerSec
export const gbPerSec = (n: number) => (n * 1e9) as BytesPerSec
export const flops = (n: number) => n as Flops
export const tflops = (n: number) => (n * 1e12) as Flops
export const seconds = (n: number) => n as Seconds
export const tokensPerSec = (n: number) => n as TokensPerSec
export const usd = (n: number) => n as Usd
export const watts = (n: number) => n as Watts
