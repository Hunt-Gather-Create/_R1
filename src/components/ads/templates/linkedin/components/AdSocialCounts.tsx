import { cn } from '@/lib/utils';
import React from 'react';

type AdSocialCountsProps = {
  reactionCount: number;
  commentText: string;
  shareText: string;
  style?: React.CSSProperties;
  className?: string;
  // Emojis are static for now as per the initial image, but could be props
};

const AdSocialCounts: React.FC<AdSocialCountsProps> = ({
  reactionCount,
  commentText,
  shareText,
  style = {},
  className,
}) => {
  return (
    <div className={cn('px-4 pt-3 pb-2 border-t border-gray-200', className)} style={{ ...style }}>
      <div className="flex justify-between items-center">
        {/* Left: Reactions */}
        <div className="flex items-center">
          {/* Using simple text emojis. For specific circular icon styles shown in mockups, further refinement with SVGs or custom components might be needed. */}
          <span className="text-xs" role="img" aria-label="Reactions, including thinking face and lightbulb">
            🤔💡
          </span>
          <span className="ml-1.5 text-xs text-gray-700 font-medium">{reactionCount.toLocaleString()}</span>
        </div>
        {/* Right: Comments and Shares */}
        <div className="text-xs text-gray-500">
          <span>{commentText}</span>
          <span className="ml-3">{shareText}</span>
        </div>
      </div>
    </div>
  );
};

export default AdSocialCounts;
