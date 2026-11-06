// The tip jar. To switch it on, put your PayPal.me name here: the part after
// paypal.me/ in your link (https://paypal.me/NAME). Every tip button on the
// page then opens PayPal; until then they show a short "coming soon" note.
export const SUPPORT = {
  paypal: "",
  repo: "https://github.com/arpwatcher/CCNA-Practise-",
};

export const tipUrl = () => (SUPPORT.paypal ? `https://www.paypal.com/paypalme/${encodeURIComponent(SUPPORT.paypal)}` : null);
