import React from 'react';
import { TiktokAdIcons, ICON_NAMES } from './TiktokAdIcons';
import { tiktokAdLayout, tiktokColors, tiktokText } from '../config';

export const TiktokAdMenu = () => {
  return (
    <div
      className="flex items-center justify-between w-full"
      style={{
        backgroundColor: tiktokColors.black,
        paddingLeft: tiktokAdLayout.spacing.xxl,
        paddingRight: tiktokAdLayout.spacing.xxl,
        paddingTop: tiktokAdLayout.spacing.md,
        paddingBottom: tiktokAdLayout.spacing.md,
      }}
    >
      <div className="flex items-center gap-1 flex-col">
        <TiktokAdIcons name={ICON_NAMES.HOME} width={22} height={22} />
        <span style={{ fontSize: tiktokText.fontSize.sss, letterSpacing: tiktokText.spacing.sm }}>Home</span>
      </div>
      <div className="flex items-center gap-1 flex-col opacity-50">
        <TiktokAdIcons name={ICON_NAMES.SEARCH} width={24} height={24} />
        <span style={{ fontSize: tiktokText.fontSize.sss, letterSpacing: tiktokText.spacing.sm }}>Search</span>
      </div>
      <TiktokAddIcon />
      <div className="flex items-center gap-1 flex-col opacity-50">
        <TiktokAdIcons name={ICON_NAMES.INBOX} width={20} height={20} />
        <span style={{ fontSize: tiktokText.fontSize.sss, letterSpacing: tiktokText.spacing.sm }}>Inbox</span>
      </div>
      <div className="flex items-center gap-1 flex-col opacity-50">
        <TiktokAdIcons name={ICON_NAMES.USER} width={21} height={21} />
        <span style={{ fontSize: tiktokText.fontSize.sss, letterSpacing: tiktokText.spacing.sm }}>User</span>
      </div>
    </div>
  );
};

const TiktokAddIcon = ({ width = 41, height = 25 }: { width?: number; height?: number }) => {
  return (
    <svg width={width} height={height} viewBox="0 0 41 25" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.875" width="32" height="25" rx="7" fill="#65D2E9"></rect>{' '}
      <rect x="8.125" width="32" height="25" rx="7" fill="#E6436D"></rect>{' '}
      <rect x="4" width="32" height="25" rx="7" fill="white"></rect>{' '}
      <path
        d="M19.0276 6C18.5328 6 18.1316 6.40118 18.1316 6.89606V11.1316H13.8961C13.4012 11.1316 13 11.5328 13 12.0276V12.9724C13 13.4672 13.4012 13.8684 13.8961 13.8684H18.1316V18.1039C18.1316 18.5988 18.5328 19 19.0276 19H19.9724C20.4672 19 20.8684 18.5988 20.8684 18.1039V13.8684H25.1039C25.5988 13.8684 26 13.4672 26 12.9724V12.0276C26 11.5328 25.5988 11.1316 25.1039 11.1316H20.8684V6.89606C20.8684 6.40118 20.4672 6 19.9724 6H19.0276Z"
        fill="black"
      ></path>
    </svg>
  );
};
