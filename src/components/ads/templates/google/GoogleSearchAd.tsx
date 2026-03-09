import React from 'react';
import { z } from 'zod';
import { companySchema, searchSchema } from './schema';
import GoogleAdCard from './components/GoogleAdCard';
import GoogleAdProfile from './components/GoogleAdProfile';
import { googleAdColors, googleAdFonts, googleAdLayout } from './config';
import { MapPin } from 'lucide-react';

export const GoogleSearchAdContentSchema = z.object({
  company: companySchema,
  search: searchSchema,
});

export const GoogleSearchAdSchema = {
  description: 'Generate a Google Search Ad',
  inputSchema: z.object({
    name: z.string().describe('Name of the Google Search Ad'),
    type: z.enum(['ad-template:google-search-ad']).describe('Type identifier for this ad format'),
    content: GoogleSearchAdContentSchema,
  }),
};

export interface GoogleSearchAdProps {
  name: string;
  type: 'ad-template:google-search-ad';
  content: z.infer<typeof GoogleSearchAdContentSchema>;
}

export default function GoogleSearchAd({ content }: GoogleSearchAdProps) {
  const { company, search } = content;

  return (
    <GoogleAdCard style={{ gap: googleAdLayout.spacing.md }} className="flex flex-col">
      <span style={{ fontWeight: googleAdFonts.fontWeights.bold }}>Sponsored</span>
      <GoogleAdProfile {...company} />
      <a
        href={search.link}
        target="_blank"
        rel="noopener noreferrer"
        className="line-clamp-1 cursor-pointer hover:underline"
        style={{
          fontSize: googleAdFonts.fontSizes.xl,
          color: googleAdColors.link,
          textDecorationColor: googleAdColors.link,
        }}
        title={search.title}
        aria-label={search.title}
      >
        {search.title}
      </a>
      <p className="line-clamp-3" title={search.description} aria-label={search.description}>
        {search.description}
      </p>
      {search.location && (
        <div className="flex items-center group cursor-pointer" style={{ gap: googleAdLayout.spacing.sm }}>
          <MapPin className="w-4 h-4 opacity-50" style={{ color: googleAdColors.icon }} />
          <span
            style={{
              fontSize: googleAdFonts.fontSizes.md,
              color: googleAdColors.link,
              textDecorationColor: googleAdColors.link,
            }}
            className="group-hover:underline"
          >
            {search.location}
          </span>
        </div>
      )}
      {search.suggestedSearches && search.suggestedSearches.length > 0 && (
        <div className="flex items-center flex-wrap" style={{ columnGap: googleAdLayout.spacing.ms }}>
          {search.suggestedSearches.map((suggestedSearch, index) => (
            <React.Fragment key={index}>
              {index > 0 && (
                <div className="w-[2px] h-[2px] rounded-full" style={{ backgroundColor: googleAdColors.icon }} />
              )}
              <a
                href={suggestedSearch.link}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer hover:underline whitespace-nowrap"
                style={{
                  fontSize: googleAdFonts.fontSizes.md,
                  color: googleAdColors.link,
                  textDecorationColor: googleAdColors.link,
                }}
              >
                {suggestedSearch.title}
              </a>
            </React.Fragment>
          ))}
        </div>
      )}
    </GoogleAdCard>
  );
}
