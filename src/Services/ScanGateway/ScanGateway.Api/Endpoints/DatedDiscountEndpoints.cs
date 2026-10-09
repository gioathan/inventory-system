using InventorySystem.Auth.Contracts;
using InventorySystem.ScanGateway.Api.Clients;

namespace InventorySystem.ScanGateway.Api.Endpoints;

// Discounts that apply by themselves on chosen dates and repeat every year (see DatedDiscount in
// Catalog.Api). Admin-only throughout, like the manual discounts next door. Catalog owns the
// rules and the calendar; a refusal comes back as its own message.
public static class DatedDiscountEndpoints
{
    public static void MapDatedDiscountEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/dated-discounts").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("", async (CatalogApiClient catalog, CancellationToken cancellationToken) =>
            Results.Ok(await catalog.GetDatedDiscountsAsync(cancellationToken)));

        group.MapPost("", (SaveDatedDiscountBody body, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            SaveAsync(null, body, catalog, cancellationToken));

        // A full replace, like the form that submits it.
        group.MapPut("/{id:guid}", (Guid id, SaveDatedDiscountBody body, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            SaveAsync(id, body, catalog, cancellationToken));

        // Skip = true turns off the coming occurrence only; false turns it back on.
        group.MapPost("/{id:guid}/skip", (Guid id, SkipDatedDiscountBody body, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            RunAsync(async () => Results.Ok(await catalog.SetDatedDiscountSkipAsync(id, body.Skip, cancellationToken))));

        group.MapDelete("/{id:guid}", (Guid id, CatalogApiClient catalog, CancellationToken cancellationToken) =>
            RunAsync(async () =>
            {
                await catalog.DeleteDatedDiscountAsync(id, cancellationToken);
                return Results.NoContent();
            }));
    }

    private static Task<IResult> SaveAsync(Guid? id, SaveDatedDiscountBody body, CatalogApiClient catalog, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(body.Name))
            return Task.FromResult(Results.BadRequest("Name is required."));
        if (body.Periods is null || body.Periods.Count == 0)
            return Task.FromResult(Results.BadRequest("Choose at least one date."));
        if (body.Skus is null || body.Skus.Count == 0)
            return Task.FromResult(Results.BadRequest("Choose at least one item."));

        return RunAsync(async () => Results.Ok(await catalog.SaveDatedDiscountAsync(
            id, body.Name.Trim(), body.Percentage, body.Periods.Select(p => (p.StartDate, p.EndDate)), body.Skus, cancellationToken)));
    }

    private static async Task<IResult> RunAsync(Func<Task<IResult>> action)
    {
        try
        {
            return await action();
        }
        catch (CatalogItemsNotFoundException ex)
        {
            return Results.NotFound(ex.Message);
        }
        catch (CatalogRuleException ex)
        {
            return Results.BadRequest(ex.Message);
        }
    }
}

public record SaveDatedDiscountBody(string Name, double Percentage, List<DatedDiscountPeriod> Periods, List<string> Skus);
public record SkipDatedDiscountBody(bool Skip);
