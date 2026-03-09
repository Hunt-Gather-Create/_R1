export const ASPECT_RATIO_MAP = {
  '1:1': '1024x1024',
  '4:3': '1024x1365',
  '3:4': '1365x1024',
  '4:5': '1024x1280',
  '16:9': '1024x576',
  '9:16': '1024x1820',
} as const;

export type AspectRatio = keyof typeof ASPECT_RATIO_MAP;
export type Size = typeof ASPECT_RATIO_MAP[AspectRatio];

export const getSizeForAspectRatio = (aspectRatio: AspectRatio): Size => {
  return ASPECT_RATIO_MAP[aspectRatio];
};

export const getAspectRatioValue = (ratio: AspectRatio): number => {
  const [width, height] = ratio?.split(':').map(Number) ?? [1, 1];
  return width / height;
};
