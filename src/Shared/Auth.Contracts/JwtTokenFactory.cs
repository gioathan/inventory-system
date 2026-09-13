using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace InventorySystem.Auth.Contracts;

public record IssuedToken(string AccessToken, DateTimeOffset ExpiresAt);

// The one place a token is actually created — only Staff.Api calls this, but it lives here so
// the exact claim shape (and the key/issuer/audience it's signed with) is defined once and
// shared with the validation side in AuthServiceCollectionExtensions, rather than risking the
// two drifting apart.
public static class JwtTokenFactory
{
    public static IssuedToken CreateToken(Guid userId, string username, string role, string signingKey)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.Add(JwtConstants.TokenLifetime);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, username),
            new Claim(ClaimTypes.Role, role)
        };

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: JwtConstants.Issuer,
            audience: JwtConstants.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: credentials);

        return new IssuedToken(new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
