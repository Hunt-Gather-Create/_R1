import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderInstagramCarousel(content: unknown, mediaUrls?: string[]): string {
  const c = content as {
    profile?: { username?: string; image?: string; imageBackgroundColor?: string | null };
    caption?: string;
    content?: Array<{ prompt?: string; altText?: string }>;
    cta?: { text?: string };
    likes?: number;
  };

  const profile = c.profile;
  const username = escapeHtml(profile?.username || "Your Brand");
  const profileImg = profileImageHtml(
    profile?.image,
    profile?.imageBackgroundColor,
    36,
    username,
    true
  );
  const caption = escapeHtml(c.caption || "");
  const ctaText = escapeHtml(c.cta?.text || "Learn more");
  const likes = c.likes ?? 17;
  const slides = c.content || [];

  const slideHtml = slides
    .map((slide, i) => {
      const url = mediaUrls?.[i] || "";
      const alt = escapeHtml(slide.altText || "Carousel image");
      return url
        ? `<div style="flex-shrink:0;width:100%;"><img src="${escapeHtml(url)}" alt="${alt}" style="width:100%;aspect-ratio:1/1;object-fit:cover;" /></div>`
        : `<div style="flex-shrink:0;width:100%;aspect-ratio:1/1;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;">Slide ${i + 1}</div>`;
    })
    .join("\n");

  const dots = slides
    .map((_, i) => `<span style="width:6px;height:6px;border-radius:50%;background:${i === 0 ? "#3698EF" : "#dbdbdb"};"></span>`)
    .join("");

  const body = `
<div style="max-width:500px;width:100%;background:#fff;border:1px solid #dbdbdb;border-radius:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#262627;font-size:14px;">
  <div style="display:flex;align-items:center;padding:12px 16px;gap:10px;">
    ${profileImg}
    <div><div style="font-weight:600;">${username}</div><div style="font-size:12px;color:#737373;">Sponsored</div></div>
  </div>
  <div style="overflow:hidden;">
    <div style="display:flex;width:${slides.length * 100}%;">
      ${slideHtml}
    </div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#fafafa;border-top:1px solid #efefef;border-bottom:1px solid #efefef;">
    <span style="font-weight:600;">${ctaText}</span>
  </div>
  <div style="padding:12px 16px;">
    <div style="display:flex;gap:4px;justify-content:center;margin-bottom:8px;">${dots}</div>
    <div style="font-weight:600;margin-bottom:6px;">${likes.toLocaleString()} likes</div>
    <div><span style="font-weight:600;">${username}</span> ${caption}</div>
  </div>
</div>`;

  return htmlWrapper("Instagram Carousel", body);
}
