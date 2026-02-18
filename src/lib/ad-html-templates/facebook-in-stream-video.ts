import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderFacebookInStreamVideo(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    company?: string;
    companyAbbreviation?: string;
    url?: string;
    primaryText?: string;
    image?: string;
    callToAction?: string;
    profile?: { imageUrl?: string; imageBackgroundColor?: string | null };
    secondaryAd?: {
      title?: string;
      description?: string;
      image?: string;
    };
  };

  const company = escapeHtml(c.company || "Company");
  const abbrev = escapeHtml(c.companyAbbreviation || company.slice(0, 2));
  const profile = c.profile;
  const profileImg = profileImageHtml(
    profile?.imageUrl,
    profile?.imageBackgroundColor,
    36,
    company,
    true
  );
  const primaryText = escapeHtml(c.primaryText || "");
  const ctaText = escapeHtml(c.callToAction || "Learn More");
  const imageUrl = mediaUrls?.[0] || "";
  const url = escapeHtml(c.url || "#");

  const body = `
<div style="max-width:500px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#050505;display:flex;flex-direction:column;gap:16px;">
  <!-- Primary Ad -->
  <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;">
      ${profileImg}
      <div>
        <div style="font-weight:600;font-size:14px;">${company}</div>
        <div style="font-size:12px;color:#65676b;">Sponsored</div>
      </div>
    </div>
    <div style="padding:0 16px 12px;font-size:14px;line-height:1.5;">${primaryText}</div>
    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${company}" style="width:100%;aspect-ratio:1/1;object-fit:cover;background:#f0f0f0;" />` : `<div style="width:100%;aspect-ratio:1/1;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;">Image placeholder</div>`}
    <div style="padding:12px 16px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#65676b;margin-bottom:8px;">
        <span>345 reactions</span><span>2K Comments &bull; 1K Shares</span>
      </div>
      <div style="display:flex;justify-content:space-around;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;padding:8px 0;color:#65676b;font-size:14px;">
        <span>Like</span><span>Comment</span><span>Share</span>
      </div>
      <a href="${url}" style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;color:#1877f2;text-decoration:none;font-size:14px;font-weight:500;">${ctaText} &rsaquo;</a>
    </div>
  </div>
</div>`;

  return htmlWrapper("Facebook In-Stream Video Ad", body);
}
