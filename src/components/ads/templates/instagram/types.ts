
export interface InstagramAdBase {
    profile: InstagramAdProfile;
    cta: InstagramAdCTA;
    caption: string;
}

export interface InstagramAdFeedPost extends InstagramAdBase {
    aspectRatio?: '1:1' | '4:5' | '16:9';
    likes?: number;
    content: InstagramAdContent;
}

export interface InstagramAdCarousel extends InstagramAdBase {
    aspectRatio?: '1:1';
    likes?: number;
    content: InstagramAdContent[];
}

export interface InstagramAdStory extends InstagramAdBase {
    content: InstagramAdContent;
    aspectRatio?: '9:16';
}

export interface InstagramAdReel extends InstagramAdBase {
    likes: number;
    comments: number;
    content: InstagramAdContent;
    aspectRatio?: '9:16';
}

export type InstagramAdContent = {
    prompt: string;
    altText: string;
}

export interface InstagramAdProfile {
    image?: string | null;
    imagePrompt?: string | null;
    username: string;
    imageBackgroundColor?: string | null;
    imageAltText?: string | null;
}

export enum InstagramAdCTAEnum {
    LEARN_MORE = 'Learn more',
    APPLY_NOW = 'Apply now',
    BOOK_NOW = 'Book now',
    CONTACT_US = 'Contact us',
    SHOP_NOW = 'Shop now',
    DOWNLOAD = 'Download',
    GET_DIRECTIONS = 'Get directions',
    GET_QUOTE = 'Get quote',
    SEND_MESSAGE = 'Send message',
    ORDER_NOW = 'Order now',
    SIGN_UP = 'Sign up',
    WATCH_MORE = 'Watch More',
    TRY_IN_CAMERA = 'Try in Camera',
    SUBSCRIBE = 'Subscribe',
    LISTEN_NOW = 'Listen now',
    SEE_MENU = 'See menu',
    REQUEST_TIME = 'Request time',
    CALL_NOW = 'Call now',
}

export type InstagramAdCTA = {
    text: InstagramAdCTAEnum;
    url?: string;
};
