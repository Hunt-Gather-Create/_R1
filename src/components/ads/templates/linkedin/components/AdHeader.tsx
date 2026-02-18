import React from 'react';
import { linkedInBranding, linkedInColors, linkedInFonts, linkedInLayout } from '../config';
import { MoreHorizontal } from 'lucide-react';
import { RetryImage } from '@/components/ads/components/RetryImage';

interface AdHeaderProps {
  profileImageUrl?: string;
  title: string; // Can be company name or ad title
  sponsoredText?: string; // e.g., "Sponsored"
  metadataText?: string; // e.g., follower count, job title, etc.
  /** Background color for the profile image (e.g. workspace brand primary color) */
  imageBackgroundColor?: string | null;
}

export default function AdHeader({
  profileImageUrl,
  title,
  sponsoredText = 'Sponsored',
  metadataText,
  imageBackgroundColor,
}: AdHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: linkedInLayout.spacingMedium }}>
      <div style={{
        width: '48px', // LinkedIn standard size for profile pic in feed
        height: '48px',
        borderRadius: '50%',
        backgroundColor: imageBackgroundColor ?? linkedInColors.secondary,
        marginRight: linkedInLayout.spacingSmall,
        overflow: 'hidden',
      }}>
        <RetryImage
          src={profileImageUrl || linkedInBranding.profilePlaceholder}
          alt={`${title} logo`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <div className="flex gap-1 justify-between w-full" style={{ fontFamily: linkedInFonts.primary, color: linkedInColors.textPrimary }}>
        <div>
        <p style={{
          fontWeight: linkedInFonts.weights.semibold,
          fontSize: linkedInFonts.sizes.small,
          margin: 0,
          color: linkedInColors.textPrimary,
        }}>
          {title}
        </p>
        {(sponsoredText || metadataText) && (
          <p style={{
            fontSize: linkedInFonts.sizes.xsmall,
            color: linkedInColors.textMuted,
            margin: 0,
          }}>
            {sponsoredText && <span>{sponsoredText}</span>}
            {sponsoredText && metadataText && <span> &middot; </span>}
            {metadataText && <span>{metadataText}</span>}
          </p>
        )}
        </div>
        <div className="flex flex-1 items-center justify-end">
          <MoreHorizontal className="text-gray-500 w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
