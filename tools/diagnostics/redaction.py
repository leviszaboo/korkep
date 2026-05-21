import os
import re


SECRET_ENV_NAMES = (
    "DATABASE_URL",
    "NEON_API_KEY",
    "OPENROUTER_API_KEY",
    "GOOGLE_AI_STUDIO_API_KEY",
)


def redact(text):
    redacted = str(text)
    for name in SECRET_ENV_NAMES:
        value = os.environ.get(name)
        if value:
            redacted = redacted.replace(value, f"<redacted:{name}>")
    redacted = re.sub(r"postgresql://[^@\s]+@", "postgresql://<redacted>@", redacted)
    redacted = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer <redacted>", redacted)
    return redacted
