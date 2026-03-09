export enum TiktokAdCTAEnum {
    LEARN_MORE = 'Learn more',
    DOWNLOAD = 'Download',
    SHOP_NOW = 'Shop now',
    SIGN_UP = 'Sign up',
    CONTACT_US = 'Contact us',
    APPLY_NOW = 'Apply now',
    BOOK_NOW = 'Book now',
    PLAY_GAME = 'Play game',
    WATCH_NOW = 'Watch now',
    READ_MORE = 'Read more',
    VIEW_NOW = 'View now',
    GET_QUOTE = 'Get quote',
    ORDER_NOW = 'Order now',
    INSTALL_NOW = 'Install now',
    GET_SHOWTIMES = 'Get showtimes',
    LISTEN_NOW = 'Listen now',
    INTERESTED = 'Interested',
    SUBSCRIBE = 'Subscribe',
    GET_TICKETS_NOW = 'Get tickets now',
    EXPERIENCE_NOW = 'Experience now',
    PRE_ORDER_NOW = 'Pre-order now',
    VISIT_STORE = 'Visit store',
}

export interface TiktokAdContent {
    profile: { image: string; username: string };
    sound: { name: string; author: string };
    content: { prompt: string; altText: string };
    caption: string;
    cta: { text: TiktokAdCTAEnum; url?: string; color?: string };
}
