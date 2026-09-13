using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace InventorySystem.Auth.Contracts;

public static class AuthServiceCollectionExtensions
{
    // Called once by every service (including Catalog/Inventory's gRPC endpoints, not just the
    // REST/GraphQL front doors) — the whole point of this step was closing the "anyone can hit
    // any endpoint directly" gap for real, not just at the intended Scan Gateway/Dashboard entry
    // points. Same signing key, issuer, and audience everywhere, or validation would never agree.
    public static IServiceCollection AddInventorySystemJwtAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var signingKey = configuration[JwtConstants.SigningKeyConfigKey]
            ?? throw new InvalidOperationException($"Missing configuration value '{JwtConstants.SigningKeyConfigKey}'.");

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = JwtConstants.Issuer,
                    ValidateAudience = true,
                    ValidAudience = JwtConstants.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(1)
                };
            });

        services.AddAuthorizationBuilder()
            .AddPolicy(AuthPolicies.SellerOrAdmin, policy => policy.RequireRole(StaffRoles.Admin, StaffRoles.Seller))
            .AddPolicy(AuthPolicies.AdminOnly, policy => policy.RequireRole(StaffRoles.Admin));

        return services;
    }
}
