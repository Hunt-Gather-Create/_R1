"use client";

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import React, { useState } from 'react';
import { ArtifactProvider, type ArtifactProviderProps } from '@/components/ads/context/ArtifactProvider';
import { useArtifactActions } from '@/components/ads/hooks/useArtifactActions';
import ArtifactControlsBar from './ArtifactControlsBar';
import { Save, Check } from 'lucide-react';

interface ArtifactWrapperProps extends ArtifactProviderProps {
  showMediaCount?: boolean;
  showControls?: boolean;
  className?: string;
}

const ArtifactWrapperControls = () => {
  const { save, isSaving, isLoading } = useArtifactActions();
  const [saved, setSaved] = useState(false);

  if (isLoading) return null;

  const handleSave = async () => {
    await save();
    setSaved(true);
  };

  return (
    <div className="flex border p-0 rounded-lg mt-0.5 bg-muted/50 overflow-hidden [&_button]:rounded-[0px] [&>button]:text-sm [&>button]:flex-1 [&>button]:text-muted-foreground">
      <Button className="hover:bg-primary/10 hover:text-foreground" variant="ghost" onClick={handleSave}>
        {saved ? <Check className="w-4 h-4 text-green-500" /> : <Save className="w-4 h-4" />}
        {isSaving ? 'Saving...' : saved ? 'Saved' : 'Save'}
      </Button>
    </div>
  );
};

const ArtifactWrapper: React.FC<ArtifactWrapperProps> = ({ children, showMediaCount = true, showControls = true, className, ...providerProps }) => {
  return (
    <ArtifactProvider {...providerProps}>
      <div className="relative">
        <div className={cn("w-full bg-muted/30 border border-border rounded-lg pb-6", className)}>
          {showControls && <ArtifactControlsBar showMediaCount={showMediaCount} />}
          {children}
        </div>

        {showControls && <ArtifactWrapperControls />}
      </div>
    </ArtifactProvider>
  );
};

export default ArtifactWrapper;
