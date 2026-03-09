import React from 'react';
import { linkedInColors, linkedInFonts, linkedInLayout } from '../config';

interface AdActionButtonProps {
  text: string;
  url?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary'; // Add more variants as needed
  fullWidth?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function AdActionButton({
  text,
  url,
  onClick,
  variant = 'primary',
  fullWidth = true,
  className,
  style
}: AdActionButtonProps) {
  const buttonStyle: React.CSSProperties = {
    fontFamily: linkedInFonts.primary,
    fontSize: linkedInFonts.sizes.medium,
    fontWeight: linkedInFonts.weights.semibold,
    color: variant === 'primary' ? linkedInColors.textLight : linkedInColors.action,
    backgroundColor: variant === 'primary' ? linkedInColors.action : 'transparent',
    border: variant === 'secondary' ? `1px solid ${linkedInColors.action}` : 'none',
    paddingTop: linkedInLayout.spacingSmall,
    paddingBottom: linkedInLayout.spacingSmall,
    paddingLeft: linkedInLayout.spacingMedium,
    paddingRight: linkedInLayout.spacingMedium,
    borderRadius: linkedInLayout.borderRadius,
    width: fullWidth ? '100%' : 'auto',
    textAlign: 'center',
    cursor: 'pointer',
    display: 'inline-block',
    textDecoration: 'none',
    ...style,
  };

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Using the existing Button component if it can be styled appropriately,
  // otherwise, a simple button/a tag would be used.
  // For this example, let's assume the Button component can take a style prop and className for full customization.
  return (
    <div className="bg-blue-500 text-white p-2 rounded-md" onClick={handleClick}>
      {text}
    </div>
  );
}
