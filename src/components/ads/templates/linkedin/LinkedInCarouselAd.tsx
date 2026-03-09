"use client";

import React, { useState } from 'react';
import { z } from 'zod';
import LinkedInAdCard from './components/LinkedInAdCard';
import AdHeader from './components/AdHeader';
import AdMainContent from './components/AdMainContent';
import AdFooter from './components/AdFooter';
import { linkedInLayout, linkedInColors, linkedInFonts, linkedInBranding } from './config';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ArtifactMedia } from '../../components/ArtifactMedia';
import AdSocialCounts from './components/AdSocialCounts';
import { CarouselItemSchema, LinkedInCarouselAdSchema } from './tools';

type CarouselAdPropsType = z.infer<typeof LinkedInCarouselAdSchema.inputSchema>;

const CarouselCard: React.FC<
  z.infer<typeof CarouselItemSchema> & { mediaIndex: number; ctaButtonText?: string; ctaButtonUrl?: string }
> = ({ imagePrompt, imageAltText, headline, mediaIndex, ctaButtonText, ctaButtonUrl }) => {
  return (
    <div
      className="overflow-hidden h-full flex flex-col min-h-[280px] border"
      style={{
        borderColor: linkedInColors.border,
        borderRadius: linkedInLayout.borderRadius,
        backgroundColor: linkedInColors.backgroundLight,
      }}
    >
      <div className="relative w-full h-full overflow-hidden rounded-t-[8px]">
        <ArtifactMedia
          mediaIndex={mediaIndex}
          prompt={imagePrompt}
          altText={imageAltText || `Carousel image for ${headline}`}
          aspectRatio="1:1"
          mediaType="image"
        />
      </div>
      <div
        className="p-4 border-t text-center flex-grow flex justify-between items-center"
        style={{
          padding: `${linkedInLayout.spacingSmallMedium} ${linkedInLayout.spacingMedium}`,
          borderTopColor: linkedInColors.border,
        }}
      >
        <h4
          className="m-0 max-h-[40px] overflow-hidden text-ellipsis line-clamp-2"
          style={{
            fontFamily: linkedInFonts.primary,
            fontSize: linkedInFonts.sizes.small,
            color: linkedInColors.textPrimary,
          }}
        >
          {headline}
        </h4>

        {ctaButtonText && (
          <a
            href={ctaButtonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border"
            style={{
              color: linkedInColors.action,
              textDecoration: 'none',
              fontSize: linkedInFonts.sizes.small,
              fontWeight: linkedInFonts.weights.semibold,
              borderColor: linkedInColors.action,
              padding: `${linkedInLayout.spacingXSmall} ${linkedInLayout.spacingLarge}`,
            }}
          >
            {ctaButtonText}
          </a>
        )}
      </div>
    </div>
  );
};

export const LinkedInCarouselAd: React.FC<CarouselAdPropsType> = ({ content }) => {
  const {
    companyName,
    profileImageUrl,
    followerCount,
    adCopy,
    carouselItems = [],
    overallCtaButtonText,
    overallDestinationUrl,
  } = content;

  const [currentIndex, setCurrentIndex] = useState(0);

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + carouselItems.length) % carouselItems.length);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % carouselItems.length);
  };

  const headerTitle = companyName;
  const profile = content && typeof (content as { profile?: unknown }).profile === "object" ? (content as unknown as { profile: { profileImageUrl?: string; imageBackgroundColor?: string | null } }).profile : undefined;
  const companyLogo =
    profile?.profileImageUrl ?? linkedInBranding.logoPlaceholder ?? profileImageUrl;
  const profileImageBg = profile?.imageBackgroundColor;

  const socialCounts = React.useMemo(
    () => ({
      reactionCount: Math.floor(Math.random() * 100),
      commentCount: Math.floor(Math.random() * 100),
      shareCount: Math.floor(Math.random() * 100),
    }),
    [],
  );

  const itemWidthPercentage = 80;
  const w = itemWidthPercentage;
  const n = carouselItems.length;
  const i = currentIndex;
  const translateX = Math.min((i / n) * 100, 100 - (100 / n) * (100 / w));

  return (
    <LinkedInAdCard className="w-full">
      <AdHeader
        title={headerTitle}
        profileImageUrl={companyLogo}
        metadataText={followerCount ? `${followerCount.toLocaleString()} followers` : undefined}
        imageBackgroundColor={profileImageBg}
      />
      <AdMainContent
        copy={adCopy}
        imagePrompt=""
        mediaType="carousel"
        style={{ padding: `0 ${linkedInLayout.spacingSmall}`, overflow: 'hidden' }}
      >
        <div className="relative" style={{ backgroundColor: linkedInColors.backgroundLight }}>
          <div className="overflow-hidden" style={{ scrollSnapType: 'x mandatory' }}>
            <div
              className="flex flex-nowrap"
              style={{
                transition: 'transform 0.5s ease-in-out',
                transform: `translateX(-${translateX}%)`,
                width: `${carouselItems.length * itemWidthPercentage}%`,
              }}
            >
              {carouselItems.map((item, index) => (
                <div
                  key={index}
                  style={{
                    flexShrink: 0,
                    width: `${100 / carouselItems.length}%`,
                    padding: `0 ${linkedInLayout.spacingSmall}`,
                  }}
                >
                  <CarouselCard
                    mediaIndex={index}
                    {...item}
                    ctaButtonText={overallCtaButtonText!}
                    ctaButtonUrl={overallDestinationUrl!}
                  />
                </div>
              ))}
            </div>
          </div>

          {carouselItems.length > 1 && (
            <>
              <button
                onClick={goToPrevious}
                className="absolute top-1/2 left-4 bg-black/50 border-none text-white rounded-full cursor-pointer w-[32px] h-[32px] flex items-center justify-center"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={goToNext}
                className="absolute top-1/2 right-4 bg-black/50 border-none text-white rounded-full cursor-pointer w-[32px] h-[32px] flex items-center justify-center"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>
      </AdMainContent>
      <AdSocialCounts
        className="border-t-0 pb-1 pt-4 px-0"
        reactionCount={socialCounts.reactionCount}
        commentText={`${socialCounts.commentCount} comments`}
        shareText={`${socialCounts.shareCount} shares`}
      />
      <AdFooter />
    </LinkedInAdCard>
  );
};
