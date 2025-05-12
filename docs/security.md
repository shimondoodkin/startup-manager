# Startup Manager Security Guide

## Overview

This document outlines the security features implemented in the Startup Manager application and provides guidance for secure deployment and configuration.

## Security Features

### HTTP Security Headers (Helmet)

The application uses Helmet middleware to set security-related HTTP headers that help protect against common web vulnerabilities:

- **Content Security Policy (CSP)**: Restricts sources of executable scripts, styles, images, etc.
- **X-XSS-Protection**: Helps prevent cross-site scripting attacks
- **X-Frame-Options**: Prevents clickjacking by restricting frame embedding
- **X-Content-Type-Options**: Prevents MIME-sniffing attacks
- **Referrer-Policy**: Controls how much referrer information is sent
- **Strict-Transport-Security**: Enforces HTTPS connections

### Rate Limiting

Implements rate limiting to protect against brute force attacks and denial of service attempts:

- Configurable time window (`RATE_LIMIT_WINDOW_MINUTES`)
- Configurable request limit (`RATE_LIMIT_MAX_REQUESTS`)

### IP Address Logging

All requests are logged with the client's IP address for security monitoring and audit purposes:

- Properly handles `X-Forwarded-For` headers for clients behind proxies
- Sanitizes IP addresses before logging

### Authentication Security

- Basic authentication for admin access
- No cookies or sessions used, reducing attack surface
- Credentials stored in environment variables or config file

### Sensitive Data Protection

- Sensitive data is filtered from logs (passwords, tokens, secrets)
- Credentials are never exposed in client-side code

## Security Configuration

### Required Environment Variables for Production

These environment variables MUST be set in a production environment:

```
# Change these default values in production
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-strong-admin-password

# Security settings
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com
```

### Recommended Settings

- Always run behind a reverse proxy (like Nginx) in production
- Configure HTTPS with strong TLS settings
- Set appropriate rate limits based on expected traffic
- Restrict network access to the application where possible

## Security Practices for Development

- Never commit `.env` files to version control
- Use different secrets for development and production
- Regularly update dependencies to patch security vulnerabilities
- Run security scanning tools regularly

## Security Incident Response

If you discover a security vulnerability:

1. Document the issue and potential impact
2. Temporarily disable affected functionality if needed
3. Implement and test a fix
4. Update documentation
5. Notify affected users if necessary
