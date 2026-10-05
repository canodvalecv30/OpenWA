package com.rmyndharis.openwa.model;

/** Media payload for a status post: provide {@code url} OR {@code base64}. */
public record StatusMediaInput(String url, String base64, String mimetype) {
    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String url;
        private String base64;
        private String mimetype;

        public Builder url(String v) {
            this.url = v;
            return this;
        }

        public Builder base64(String v) {
            this.base64 = v;
            return this;
        }

        /**
         * MIME type of the media. When omitted the server uses the route's default
         * ({@code image/jpeg}, {@code video/mp4} or {@code audio/ogg; codecs=opus}), which also
         * overrides a URL's Content-Type; the bytes are never inspected. Set it for base64 and for
         * any media of another type.
         */
        public Builder mimetype(String v) {
            this.mimetype = v;
            return this;
        }

        public StatusMediaInput build() {
            return new StatusMediaInput(url, base64, mimetype);
        }
    }
}
