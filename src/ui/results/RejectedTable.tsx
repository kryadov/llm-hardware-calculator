/**
 * RejectedTable — spec §4 «Блок "Не подошло"».
 *
 * "Пользователь видит не только что купить, но и почему нельзя дешевле."
 * One row per rejection: the configuration that was tried, the machine-readable
 * reason the solver produced, and the detail. An `oom` row additionally states
 * the deficit in GiB, because "does not fit" without a number is not a fact the
 * reader can act on — 218 GiB short means a different accelerator, 8 GiB short
 * means a lower `gpu-memory-utilization`.
 *
 * The block owns no disclosure state of its own beyond the row cap: the shell
 * decides whether the whole section is collapsed.
 */
import { useState } from 'react'

import type { AcceleratorSpec, Rejection } from '../../core/types'
import { fill, useLang } from '../i18n'
import { formatGib, formatPoint } from './format'

export interface RejectedTableProps {
  /** Rejections from `solve()`, already ordered by nearness of the miss. */
  rejections: readonly Rejection[]
  /** Catalog used to resolve `acceleratorId` to a display name. */
  accelerators?: readonly AcceleratorSpec[]
  /** Rows shown before the "show all" control appears. Default 20. */
  maxRows?: number
  className?: string
}

export default function RejectedTable({
  rejections,
  accelerators,
  maxRows = 20,
  className,
}: RejectedTableProps) {
  const { t } = useLang()
  const [showAll, setShowAll] = useState(false)

  if (rejections.length === 0) return null

  const names = new Map((accelerators ?? []).map((a) => [a.id, a.displayName]))
  const truncated = !showAll && rejections.length > maxRows
  const rows = truncated ? rejections.slice(0, maxRows) : rejections

  const configOf = (r: Rejection): string => {
    const gpus = r.parallelism.gpusPerReplica * Math.max(1, r.replicas)
    const par = [
      `TP=${r.parallelism.tp}`,
      r.parallelism.pp > 1 ? `PP=${r.parallelism.pp}` : null,
    ]
      .filter(Boolean)
      .join(' ')
    return `${fill(t.card.title, {
      gpus: formatPoint(gpus, ''),
      accelerator: names.get(r.acceleratorId) ?? r.acceleratorId,
    })} · ${t.enums.quant[r.quant]} · ${par}`
  }

  /** Extra facts the solver attached beyond the free-text detail. */
  const extraOf = (r: Rejection): string | null => {
    if (r.reason === 'oom' && r.deficitBytes !== undefined) {
      return fill(t.rejection.deficit, { gib: formatGib(r.deficitBytes) })
    }
    if (r.actual !== undefined && r.required !== undefined) {
      return fill(t.rejection.actualVsRequired, {
        actual: formatPoint(r.actual, ''),
        required: formatPoint(r.required, ''),
      })
    }
    return null
  }

  return (
    <section
      className={`rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19] ${
        className ?? ''
      }`}
    >
      <h3 className="text-sm font-semibold text-[#0b0b0b] dark:text-white">
        {fill(t.rejection.titleCount, { count: formatPoint(rejections.length, '') })}
      </h3>
      <p className="mb-3 mt-1 text-xs text-[#898781]">{t.rejection.hint}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
          <thead>
            <tr className="text-[#898781]">
              <th scope="col" className="py-1 pr-4 font-medium">
                {t.rejection.colConfig}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t.rejection.colReason}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t.rejection.colDetail}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {rows.map((r, i) => {
              const extra = extraOf(r)
              return (
                <tr key={`${r.acceleratorId}-${r.quant}-${r.reason}-${i}`} className="align-top">
                  <td className="py-1.5 pr-4 tabular-nums text-[#0b0b0b] dark:text-white">
                    {configOf(r)}
                  </td>
                  <td className="py-1.5 pr-4 text-[#52514e] dark:text-[#c3c2b7]">
                    <span title={t.rejection.reasonHelp[r.reason]}>
                      {t.rejection.reason[r.reason]}
                    </span>
                  </td>
                  <td className="py-1.5 text-[#52514e] dark:text-[#c3c2b7]">
                    <span>{r.detail}</span>
                    {extra ? (
                      <span className="block font-medium text-[#0b0b0b] dark:text-white">
                        {extra}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {truncated ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-xs text-[#898781]">
            {fill(t.rejection.truncated, { count: formatPoint(rows.length, '') })}
          </p>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded-md border border-black/10 px-2 py-1 text-[11px] font-medium text-[#52514e] hover:bg-black/[0.03] dark:border-white/10 dark:text-[#c3c2b7] dark:hover:bg-white/[0.05]"
          >
            {t.actions.showAll}
          </button>
        </div>
      ) : null}
    </section>
  )
}
