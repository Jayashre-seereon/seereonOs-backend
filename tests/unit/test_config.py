"""Configuration (port of server/src/config.ts): defaults, validation messages, production refusals."""

import pytest

from app.config import DEV_MFA_KEY, ConfigError, load_config

GOOD_KEY = 'x' * 48
PROD = {
    'APP_ENV': 'production',
    'MFA_ENCRYPTION_KEY': GOOD_KEY,
    'DATABASE_URL': 'postgres://seereon_owner:s3cret@db:5432/seereonos',
    'DATABASE_APP_URL': 'postgres://seereon_app:s3cret@db:5432/seereonos',
}


def test_defaults():
    c = load_config({})
    assert (c.env, c.port, c.rate_limit_global, c.rate_limit_auth, c.session_idle_hours, c.static_dir) == ('development', 8000, 600, 10, 12, 'dist')
    assert c.mfa_encryption_key == DEV_MFA_KEY and c.mfa_key_is_default and c.freeze_rows and not c.demo_mode
    assert load_config({'NODE_ENV': 'test'}).env == 'test' and load_config({'STATIC_DIR': ''}).static_dir is None
    assert load_config({'PORT': ' 9000 '}).port == 9000 and load_config(PROD).freeze_rows is False


@pytest.mark.parametrize(
    'env, msg',
    [
        ({'PORT': '0'}, 'PORT must be an integer between 1 and 65535 (got "0").'),
        ({'PORT': 'abc'}, 'PORT must be an integer between 1 and 65535 (got "abc").'),
        ({'DEMO_MODE': 'maybe'}, 'DEMO_MODE must be true or false (got "maybe").'),
        ({'DATABASE_URL': 'mysql://u:p@h/db'}, 'DATABASE_URL must be a postgres: or postgresql: URL (got "mysql://***@h/db").'),
        ({'CORS_ORIGINS': 'https://a.com/path'}, 'CORS_ORIGINS entries must be origins like https://app.example.com (got "https://a.com/path").'),
        ({'MFA_ENCRYPTION_KEY': 'short'}, 'MFA_ENCRYPTION_KEY must be at least 32 characters'),
        ({'APP_ENV': 'staging'}, 'APP_ENV must be development, production or test (got "staging").'),
    ],
)
def test_validation_messages(env, msg):  # type: ignore[no-untyped-def]
    with pytest.raises(ConfigError) as e:
        load_config(env)
    assert msg in str(e.value)


def test_production_refusals():
    load_config(PROD)  # ok
    for over, msg in (
        ({'MFA_ENCRYPTION_KEY': ''}, 'MFA_ENCRYPTION_KEY is required when APP_ENV=production'),
        ({'MFA_ENCRYPTION_KEY': 'CHANGE_ME_openssl_rand_base64_48_xxxxx'}, 'must not be the placeholder'),
        ({'DATABASE_URL': 'postgres://seereon_owner:seereon_owner@db/x'}, 'DATABASE_URL still uses a default/placeholder password'),
        ({'DATABASE_APP_URL': 'postgres://seereon_app:CHANGE_ME@db/x'}, 'DATABASE_APP_URL still uses a default/placeholder password'),
        ({'DEMO_MODE': 'true'}, 'DEMO_MODE=true is not allowed when APP_ENV=production.'),
    ):
        with pytest.raises(ConfigError) as e:
            load_config({**PROD, **over})
        assert msg in str(e.value)
