"use client";

import { ChevronRight, ChevronUp, Heart, MessageCircle, MoreHorizontal, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ArtifactMedia } from '../../components/ArtifactMedia';
import { type MetaDefaultProps } from '../../metaDefaults';

type FacebookInStreamVideoToolProps = MetaDefaultProps<{
  secondaryAd: {
    title: string;
    image: string;
    description: string;
  };
}>;

function EngagementMetrics() {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 w-full justify-between">
      <div className="flex items-center gap-2">
        <div className="flex -space-x-1">
          <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-500 rounded-full text-xs">&#x1F44D;</span>
          <span className="inline-flex items-center justify-center w-5 h-5 bg-red-500 rounded-full text-xs">&#x2764;</span>
          <span className="inline-flex items-center justify-center w-5 h-5 bg-yellow-500 rounded-full text-xs">&#x1F62E;</span>
        </div>
        <span className="text-sm">345</span>
      </div>
      <div>
        <span>2K Comments</span>
        <span className="mx-2">&bull;</span>
        <span>1K Shares</span>
      </div>
    </div>
  );
}

function SecondaryAd({
  companyAbbreviation,
  companyName,
  adContent: { title, description, image },
  onCollapse: handleCollapse,
  imageBackgroundColor,
}: {
  companyAbbreviation: string;
  companyName: string;
  onCollapse: () => void;
  adContent: FacebookInStreamVideoToolProps['content']['secondaryAd'];
  imageBackgroundColor?: string;
}) {
  return (
    <Card className="w-full max-w-xl bg-white duration-300 animate-in fade-in">
      <CardHeader className="flex flex-row items-start space-x-4 p-4 justify-between">
        <a href="#" className="flex items-center gap-2">
          <Avatar
            className="h-8 w-8"
            style={imageBackgroundColor ? { backgroundColor: imageBackgroundColor } : { backgroundColor: 'rgb(224 242 254)' }}
          >
            <AvatarImage src="/placeholder.svg" alt={companyName} />
            <AvatarFallback>{companyAbbreviation}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{companyName}</span>
            <span className="text-xs text-muted-foreground">Sponsored</span>
          </div>
        </a>
        <div className="flex items-center gap-2">
          <button className="ml-auto rounded-full p-2">
            <MoreHorizontal className="h-5 w-5 text-gray-500" />
            <span className="sr-only">More options</span>
          </button>
          <button className="ml-auto rounded-full p-0.5 border-2 border-gray-500" onClick={handleCollapse}>
            <ChevronUp className="h-5 w-5 text-gray-500" />
            <span className="sr-only">Collapse</span>
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex gap-4 bg-gray-100 overflow-hidden" style={{ borderRadius: '8px' }}>
          <div className="relative min-h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg">
            <ArtifactMedia
              prompt={image}
              altText={title}
              aspectRatio="1:1"
              mediaIndex={0}
              disableGenerate={true}
            />
          </div>
          <div className="flex flex-col justify-between text-sm py-3">
            <div className="space-y-0">
              <h2 className="font-semibold">{title}</h2>
              <p className="text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
        <div className="mt-2">
          <EngagementMetrics />
        </div>
      </CardContent>
    </Card>
  );
}

export default function FacebookInStreamVideo({ content }: FacebookInStreamVideoToolProps) {
  const [showSecondaryAd, setShowSecondaryAd] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const companyName = content.company;
  const profile =
    content && "profile" in content && typeof (content as Record<string, unknown>).profile === "object"
      ? ((content as Record<string, unknown>).profile as { imageUrl?: string; imageBackgroundColor?: string })
      : undefined;
  const companyLogo = profile?.imageUrl ?? '/placeholder.svg';
  const profileImageBackgroundColor = profile?.imageBackgroundColor;
  const companyAbbreviation =
    content.companyAbbreviation ?? (content.company ?? '').slice(0, 2).toUpperCase();

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSecondaryAd(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col gap-4 items-center" style={{ color: "#050505" }}>
      <Card className="w-full max-w-md overflow-hidden bg-white">
        <CardHeader className="flex flex-row items-center space-x-4 p-4 justify-between">
          <a href={content.url} target="_blank" className="flex items-center gap-2">
            <Avatar
              className="h-8 w-8"
              style={profileImageBackgroundColor ? { backgroundColor: profileImageBackgroundColor } : undefined}
            >
              <AvatarImage src={companyLogo} alt={companyName} />
              <AvatarFallback>{companyAbbreviation}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{companyName}</span>
              <span className="text-xs text-muted-foreground">Sponsored</span>
            </div>
          </a>
          <Button variant="ghost" size="icon" className="ml-auto rounded-full">
            <MoreHorizontal className="h-5 w-5" />
            <span className="sr-only">More options</span>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <p className="px-4 pb-4">{content.primaryText}</p>
          <ArtifactMedia
            prompt={content.image}
            altText={companyName}
            aspectRatio="1:1"
            mediaIndex={0}
          />
          <div className="p-4 space-y-3">
            <EngagementMetrics />
            <div className="flex items-center border-t border-b border-gray-200 py-1">
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-50 text-gray-600"
                aria-label="Like"
              >
                <Heart className="w-5 h-5" />
                <span>Like</span>
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-50 text-gray-600"
                aria-label="Comment"
              >
                <MessageCircle className="w-5 h-5" />
                <span>Comment</span>
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-50 text-gray-600"
                aria-label="Share"
              >
                <Share className="w-5 h-5" />
                <span>Share</span>
              </button>
            </div>
            <a
              href={content.url}
              target="_blank"
              className="flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 justify-between w-full"
            >
              <span className="text-sm">{content.callToAction}</span>
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </CardContent>
      </Card>

      {showSecondaryAd && !isCollapsed && (
        <div
          className="transition-all max-w-md duration-300 ease-out opacity-100 translate-y-0"
        >
          <SecondaryAd
            companyAbbreviation={companyAbbreviation}
            companyName={companyName}
            adContent={content.secondaryAd}
            onCollapse={() => setIsCollapsed(!isCollapsed)}
            imageBackgroundColor={profileImageBackgroundColor}
          />
        </div>
      )}
    </div>
  );
}
