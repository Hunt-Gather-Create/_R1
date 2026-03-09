import React from 'react';
import { ThumbsUp, MessageSquare, Share2 } from 'lucide-react';
import { linkedInColors, linkedInFonts, linkedInLayout } from '../config';

interface AdFooterProps {
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
}

const iconStyle = {
  width: '20px',
  height: '20px',
  marginRight: linkedInLayout.spacingSmall,
  color: linkedInColors.textMuted,
};

const actionTextStyle = {
  fontFamily: linkedInFonts.primary,
  fontSize: linkedInFonts.sizes.small,
  color: linkedInColors.textMuted,
};

const actionItemStyle = {
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
};

export default function AdFooter({ onLike, onComment, onShare }: AdFooterProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      fontFamily: linkedInFonts.primary,
      fontSize: linkedInFonts.sizes.small,
      color: linkedInColors.textMuted,
      borderTop: `1px solid ${linkedInColors.border}`,
      paddingTop: linkedInLayout.spacingMedium,
      marginTop: linkedInLayout.spacingMedium,
    }}>
      <div onClick={onLike} style={actionItemStyle}>
        <ThumbsUp style={iconStyle} />
        <span style={actionTextStyle}>Like</span>
      </div>
      <div onClick={onComment} style={actionItemStyle}>
        <MessageSquare style={iconStyle} />
        <span style={actionTextStyle}>Comment</span>
      </div>
      <div onClick={onShare} style={actionItemStyle}>
        <Share2 style={iconStyle} />
        <span style={actionTextStyle}>Share</span>
      </div>
    </div>
  );
}
