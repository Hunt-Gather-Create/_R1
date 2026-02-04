/**
 * Generate a DiceBear avatar URL for an audience member
 * Uses the bottts-neutral style with consistent options
 */
export function getAudienceMemberAvatarUrl(memberId: string): string {
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${memberId}&eyes=glow,happy,round&backgroundColor=7BDEFB,1E88E5,43A047,00ACC1&mouth=smile01,square01`;
}
