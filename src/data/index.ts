/**
 * Typed, validated catalogs.
 *
 * Every JSON catalog is run through its Zod parser at module scope, so a
 * malformed catalog throws at import time — in tests, in `tsc -b` consumers and
 * in the production build — rather than surfacing bad numbers to the user.
 *
 * Implements the plan's Task 3 (Data catalogs and schemas) and the spec's §5.
 */
import type { AcceleratorSpec, LoadProfile, ModelSpec } from '../core/types'
import type { ChassisCatalog, CoefficientTable, InfraTable, PricingTable, SoftwareCatalog } from './schema'
import {
  parseAccelerators,
  parseChassis,
  parseCoefficients,
  parseInfra,
  parseModels,
  parsePricing,
  parseProfiles,
  parseSoftwareCatalog,
} from './schema'

import acceleratorsRaw from './accelerators.json'
import chassisRaw from './chassis.json'
import coefficientsRaw from './coefficients.json'
import infraRaw from './infra.json'
import modelsRaw from './models.json'
import pricingRaw from './pricing.json'
import profilesRaw from './profiles.json'
import softwareRaw from './software.json'

/** Model hyperparameters, each citing an upstream HuggingFace `config.json`. */
export const MODELS: ModelSpec[] = parseModels(modelsRaw)

/** Accelerator datasheet figures across NVIDIA, AMD, consumer, Chinese and CPU/Apple. */
export const ACCELERATORS: AcceleratorSpec[] = parseAccelerators(acceleratorsRaw)

/** Load profiles: chat, coding agent, RAG, batch. */
export const PROFILES: LoadProfile[] = parseProfiles(profilesRaw)

/** Street prices and cloud hourly rates, with a single `pricesAsOf` for the file. */
export const PRICING: PricingTable = parsePricing(pricingRaw)

/** MBU/MFU efficiency coefficients per hardware family. */
export const COEFFICIENTS: CoefficientTable = parseCoefficients(coefficientsRaw)

/** Turnkey-deployment rates: colocation, power, staffing, failure rates — all as ranges. */
export const INFRA: InfraTable = parseInfra(infraRaw)

/** Host chassis classes (the server around the bare GPUs) with itemized line items. */
export const CHASSIS: ChassisCatalog = parseChassis(chassisRaw)

/** Software/services catalog for turnkey delivery, with per-preset defaults. */
export const SOFTWARE: SoftwareCatalog = parseSoftwareCatalog(softwareRaw)

export type { ChassisCatalog, CoefficientTable, InfraTable, PricingTable, SoftwareCatalog } from './schema'
