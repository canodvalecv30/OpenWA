package com.rmyndharis.openwa.model;

/** Request body for sending image/video/document/sticker media. Provide {@code url} or {@code base64}. */
public record SendMediaRequest(
    String chatId,
    String url,
    String base64,
    String mimetype,
    String filename,
    String caption,
    String quotedMessageId,
    /** WIDs to @mention; the caption must also contain the @&lt;number&gt; token. */
    java.util.List<String> mentions) {

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String chatId;
        private String url;
        private String base64;
        private String mimetype;
        private String filename;
        private String caption;
        private String quotedMessageId;
        private java.util.List<String> mentions;

        public Builder chatId(String v) {
            this.chatId = v;
            return this;
        }

        /** Mutually exclusive with {@code base64}. */
        public Builder url(String v) {
            this.url = v;
            return this;
        }

        /** Requires {@code mimetype}. */
        public Builder base64(String v) {
            this.base64 = v;
            return this;
        }

        public Builder mimetype(String v) {
            this.mimetype = v;
            return this;
        }

        /**
         * Shown only on document sends; defaults to {@code file} when omitted (whatsapp-web.js
         * first tries the URL basename). Max 255 chars.
         */
        public Builder filename(String v) {
            this.filename = v;
            return this;
        }

        /** Max 1024 chars. */
        public Builder caption(String v) {
            this.caption = v;
            return this;
        }

        /**
         * Quote an earlier message, turning this send into a reply. Engine-specific:
         * whatsapp-web.js matches the serialized message id, Baileys the raw key id of a message
         * it has already stored.
         */
        public Builder quotedMessageId(String v) {
            this.quotedMessageId = v;
            return this;
        }

        /** WIDs to @mention; the caption must also contain the @&lt;number&gt; token. */
        public Builder mentions(java.util.List<String> v) {
            this.mentions = v;
            return this;
        }

        public SendMediaRequest build() {
            return new SendMediaRequest(chatId, url, base64, mimetype, filename, caption, quotedMessageId, mentions);
        }
    }
}
