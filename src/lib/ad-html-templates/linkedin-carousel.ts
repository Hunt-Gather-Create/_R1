import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderLinkedInCarousel(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    companyName?: string;
    followerCount?: number;
    adCopy?: string;
    carouselItems?: Array<{
      imagePrompt?: string;
      imageAltText?: string;
      headline?: string;
    }>;
    overallCtaButtonText?: string;
    profile?: { profileImageUrl?: string; imageBackgroundColor?: string | null };
  };

  const companyName = escapeHtml(c.companyName || "Company");
  const profile = c.profile;
  const profileImg = profileImageHtml(
    profile?.profileImageUrl,
    profile?.imageBackgroundColor,
    48,
    companyName,
    false
  );
  const followers = c.followerCount ? `${c.followerCount.toLocaleString()} followers` : "";
  const adCopy = escapeHtml(c.adCopy || "");
  const ctaText = escapeHtml(c.overallCtaButtonText || "Learn more");
  const items = c.carouselItems || [];

  const cardsHtml = items
    .map((item, i) => {
      const url = mediaUrls?.[i] || "";
      const alt = escapeHtml(item.imageAltText || "Carousel image");
      const headline = escapeHtml(item.headline || "");
      return `
      <div style="flex-shrink:0;width:80%;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;background:#fafafa;">
        ${url ? `<img src="${escapeHtml(url)}" alt="${alt}" style="width:100%;aspect-ratio:1/1;object-fit:cover;" />` : `<div style="width:100%;aspect-ratio:1/1;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;">Slide ${i + 1}</div>`}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;">
          <span style="font-size:13px;font-weight:600;">${headline}</span>
          <span style="color:#0a66c2;font-size:13px;font-weight:600;border:1px solid #0a66c2;border-radius:20px;padding:4px 12px;">${ctaText}</span>
        </div>
      </div>`;
    })
    .join("");

  const body = `
<div style="max-width:550px;width:100%;background:#fff;border:1px solid #e0e0e0;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#000;font-size:14px;">
  <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;">
    ${profileImg}
    <div>
      <div style="font-weight:600;">${companyName}</div>
      ${followers ? `<div style="font-size:12px;color:#666;">${followers}</div>` : ""}
      <div style="font-size:12px;color:#666;">Promoted</div>
    </div>
  </div>
  <div style="padding:0 16px 12px;line-height:1.5;">${adCopy}</div>
  <div style="overflow-x:auto;padding:0 8px;">
    <div style="display:flex;gap:8px;padding-bottom:12px;">
      ${cardsHtml}
    </div>
  </div>
  <div style="display:flex;justify-content:space-around;padding:8px 16px;border-top:1px solid #e0e0e0;color:#666;font-size:13px;">
    <span>Like</span><span>Comment</span><span>Repost</span><span>Send</span>
  </div>
</div>`;

  return htmlWrapper("LinkedIn Carousel Ad", body);
}
