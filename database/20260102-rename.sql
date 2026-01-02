ALTER TABLE individual_profiles 
RENAME COLUMN email_consent TO mailing_consent;

ALTER TABLE users RENAME COLUMN has_logged_in TO is_first_login;