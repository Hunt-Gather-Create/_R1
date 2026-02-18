import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderLinkedInSingleImage(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    companyName?: string;
    followerCount?: number;
    adCopy?: string;
    imagePrompt?: string;
    imageAltText?: string;
    headline?: string;
    ctaButtonText?: string;
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
  const headline = escapeHtml(c.headline || "");
  const ctaText = escapeHtml(c.ctaButtonText || "Learn more");
  const imageUrl = mediaUrls?.[0] || "";
  const altText = escapeHtml(c.imageAltText || `Ad image for ${c.companyName}`);

  const body = `
<div style="max-width:550px;width:100%;background:#fff;border:1px solid #e0e0e0;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#000;font-size:14px;">
  <!-- Header -->
  <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;">
    ${profileImg}
    <div>
      <div style="font-weight:600;font-size:14px;">${companyName}</div>
      ${followers ? `<div style="font-size:12px;color:#666;">${followers}</div>` : ""}
      <div style="font-size:12px;color:#666;">Promoted</div>
    </div>
  </div>
  <!-- Ad copy -->
  <div style="padding:0 16px 12px;line-height:1.5;">${adCopy}</div>
  <!-- Image -->
  ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${altText}" style="width:100%;aspect-ratio:1/1;object-fit:cover;background:#f0f0f0;" />` : `<div style="width:100%;aspect-ratio:1/1;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;">Image placeholder</div>`}
  <!-- CTA -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid #e0e0e0;">
    <div>
      <div style="font-weight:600;font-size:14px;">${headline}</div>
      <div style="font-size:12px;color:#666;">${companyName}</div>
    </div>
    <div style="background:#0a66c2;color:#fff;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;">${ctaText}</div>
  </div>
  <!-- Footer -->
  <div style="display:flex;justify-content:space-around;padding:8px 16px;border-top:1px solid #e0e0e0;color:#666;font-size:13px;">
    <span>Like</span><span>Comment</span><span>Repost</span><span>Send</span>
  </div>
</div>`;

  return htmlWrapper("LinkedIn Single Image Ad", body);
}
