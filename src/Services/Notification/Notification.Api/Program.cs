using InventorySystem.Auth.Contracts;
using InventorySystem.Notification.Api.Endpoints;
using MongoDB.Driver;
using Scalar.AspNetCore;
using Wolverine;
using Wolverine.RabbitMQ;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddInventorySystemJwtAuth(builder.Configuration);

// "notificationdb" matches the database resource name AppHost.cs gives this service.
// AddMongoDBClient only registers IMongoClient; resolving the specific IMongoDatabase
// explicitly avoids depending on how the connection string embeds a default database.
builder.AddMongoDBClient("notificationdb");
builder.Services.AddSingleton(sp => sp.GetRequiredService<IMongoClient>().GetDatabase("notificationdb"));

var rabbitConnectionString = builder.Configuration.GetConnectionString("rabbitmq")
    ?? throw new InvalidOperationException("Missing 'rabbitmq' connection string.");

builder.Host.UseWolverine(opts =>
{
    // No durable message store configured here (unlike Inventory's Postgres-backed outbox) —
    // this consumer has no relational database of its own, and a missed/duplicate low-stock
    // alert is low-stakes since it's always re-derivable from Inventory's own ledger. See
    // TECH_DEBT.md.
    opts.UseRabbitMq(new Uri(rabbitConnectionString)).AutoProvision();
    opts.ListenToRabbitQueue("stock-movements");
});

builder.Services.AddOpenApi();

var app = builder.Build();

app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// Deliberately no UseHttpsRedirection() — see architecture.md / TECH_DEBT.md: it strips the
// Authorization header on the redirect it issues for any plain-HTTP request.
app.UseAuthentication();
app.UseAuthorization();

app.MapAlertEndpoints();

app.Run();
