import { z } from 'zod';

const size = z.number().int().nonnegative();
export const hostingStorageSchema = z.object({
  measuredAt: z.string().datetime(),
  registryBytes: size,
  attachmentBytes: size,
  databaseVolumeBytes: size,
  databaseBytes: size,
  registryTags: size,
});
export const storageReportSchema = z.object({
  measuredAt: z.string(),
  categories: z.array(z.object({ key: z.string(), label: z.string(), bytes: size, count: size })),
  totalBytes: size,
  trashCount: size,
  historyBytes: size,
  largestAttachments: z.array(z.object({ id: z.string(), name: z.string(), bytes: size })),
  hosting: hostingStorageSchema.nullable().optional(),
});
export type StorageReport = z.infer<typeof storageReportSchema>;

export function storageSize(bytes: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const unit = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}
