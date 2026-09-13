using InventorySystem.Auth.Contracts;
using InventorySystem.Staff.Api.Data;
using InventorySystem.Staff.Api.Endpoints;
using InventorySystem.Staff.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// "staffdb" matches the name AppHost.cs gives this database resource.
builder.AddNpgsqlDbContext<StaffDbContext>("staffdb");

builder.Services.AddOpenApi();

builder.Services.AddSingleton<IPasswordHasher<StaffUser>, PasswordHasher<StaffUser>>();
builder.Services.AddScoped<AuthService>();

builder.Services.AddInventorySystemJwtAuth(builder.Configuration);

var app = builder.Build();

app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<StaffDbContext>();
    db.Database.Migrate();

    // Nothing can call POST /staff (Admin-only) before an admin exists, so one is seeded here.
    // Dev-only credentials, deliberately simple — change before this ever runs anywhere real.
    if (!db.StaffUsers.Any())
    {
        var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
        var seedUsername = app.Configuration["Seed:AdminUsername"] ?? "admin";
        var seedPassword = app.Configuration["Seed:AdminPassword"] ?? "ChangeMe123!";
        await auth.CreateUserAsync(seedUsername, seedPassword, StaffRoles.Admin, CancellationToken.None);
    }
}

// Deliberately no UseHttpsRedirection() — see architecture.md / TECH_DEBT.md: it strips the
// Authorization header on the redirect it issues for any plain-HTTP request.
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapStaffEndpoints();
app.MapAuditLogEndpoints();

app.Run();
