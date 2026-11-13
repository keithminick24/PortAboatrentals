/**
 * Links and copy for the customer-facing header and footer, mirroring
 * portaboatrentals.com so the booking pages feel like part of the website.
 * Edit here if the WordPress menu changes.
 */
const WP = "https://www.portaboatrentals.com";

export const SITE = {
  logo: "/brand/logo.png",
  tagline: "Built for connection and lasting memories with family and friends.",
  nav: [
    { label: "Home", href: `${WP}/` },
    { label: "Our Fleet", href: `${WP}/our-fleet/` },
    { label: "Itinerary", href: `${WP}/plan-your-day-on-the-bay/` },
    { label: "About Us", href: `${WP}/about-us/` },
    { label: "FAQ", href: `${WP}/faq/` },
  ],
  footer: [
    { label: "Home", href: `${WP}/` },
    { label: "Our Fleet", href: `${WP}/our-fleet/` },
    { label: "About", href: `${WP}/about-us/` },
    { label: "Location", href: `${WP}/about-us/#location` },
    { label: "Contact Us", href: `${WP}/contact-us/` },
    { label: "FAQs", href: `${WP}/faq` },
    { label: "Privacy Policy", href: `${WP}/privacy-policy/` },
    { label: "Terms of Service", href: `${WP}/terms-of-service/` },
  ],
  social: [
    { label: "Facebook", href: "https://www.facebook.com/PortABoatRentals/", icon: "M14 8h3V4h-3c-2.8 0-4 1.7-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8.5c0-.3.2-.5.5-.5Z" },
    { label: "Instagram", href: "https://www.instagram.com/portaboatrentals", icon: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4ZM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM12 3c-2.4 0-2.7 0-3.7.1-3.3.1-4.9 1.7-5.1 5.1C3 9.2 3 9.6 3 12s0 2.7.1 3.7c.2 3.3 1.7 4.9 5.1 5.1 1 .1 1.3.1 3.8.1s2.7 0 3.7-.1c3.3-.2 4.9-1.7 5.1-5.1.1-1 .1-1.3.1-3.7s0-2.8-.1-3.8c-.2-3.3-1.7-4.9-5.1-5.1C14.7 3 14.4 3 12 3Z" },
    { label: "YouTube", href: "https://www.youtube.com/channel/UCWafckZE0BjkRicjlq5ufug", icon: "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" },
  ],
};
