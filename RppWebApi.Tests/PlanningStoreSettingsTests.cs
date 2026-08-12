using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>
/// EO-430 FR-430.2 / EO-458: the persistence profile is deployment configuration (ADR-002 / ADR-007).
/// Unknown or missing values stop startup instead of binding a store the operator did not choose.
/// </summary>
public class PlanningStoreSettingsTests
{
    [Theory]
    [InlineData("sql", PlanningStoreProvider.Sql)]
    [InlineData("postgres", PlanningStoreProvider.Postgres)]
    [InlineData("sharepoint", PlanningStoreProvider.SharePoint)]
    [InlineData("mock", PlanningStoreProvider.Mock)]
    public void Parse_ResolvesEverySupportedValue(string configured, PlanningStoreProvider expected)
    {
        Assert.Equal(expected, PlanningStoreSettings.Parse(configured));
    }

    [Theory]
    [InlineData("SQL", PlanningStoreProvider.Sql)]
    [InlineData("Postgres", PlanningStoreProvider.Postgres)]
    [InlineData("SharePoint", PlanningStoreProvider.SharePoint)]
    [InlineData("ShArEpOiNt", PlanningStoreProvider.SharePoint)]
    public void Parse_IsCaseInsensitive(string configured, PlanningStoreProvider expected)
    {
        Assert.Equal(expected, PlanningStoreSettings.Parse(configured));
    }

    [Theory]
    [InlineData("postgresql", PlanningStoreProvider.Postgres)]
    [InlineData("npgsql", PlanningStoreProvider.Postgres)]
    [InlineData("sqlserver", PlanningStoreProvider.Sql)]
    [InlineData("mssql", PlanningStoreProvider.Sql)]
    public void Parse_AcceptsEngineAliases(string configured, PlanningStoreProvider expected)
    {
        Assert.Equal(expected, PlanningStoreSettings.Parse(configured));
    }

    [Theory]
    [InlineData(" sql ", PlanningStoreProvider.Sql)]
    [InlineData("\tmock\n", PlanningStoreProvider.Mock)]
    [InlineData(" postgres ", PlanningStoreProvider.Postgres)]
    public void Parse_TrimsSurroundingWhitespace(string configured, PlanningStoreProvider expected)
    {
        Assert.Equal(expected, PlanningStoreSettings.Parse(configured));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Parse_RejectsMissingValue(string? configured)
    {
        var exception = Assert.Throws<PlanningStoreConfigurationException>(
            () => PlanningStoreSettings.Parse(configured));

        Assert.Contains("Planning:Provider", exception.Message);
        Assert.Contains("sharepoint", exception.Message);
    }

    [Theory]
    [InlineData("oracle")]
    [InlineData("share point")]
    [InlineData("mysql")]
    public void Parse_RejectsUnknownValue(string configured)
    {
        var exception = Assert.Throws<PlanningStoreConfigurationException>(
            () => PlanningStoreSettings.Parse(configured));

        Assert.Contains(configured, exception.Message);
    }

    [Fact]
    public void SupportedValues_NamesEveryProvider()
    {
        var supported = PlanningStoreSettings.SupportedValues;

        Assert.Contains("sql", supported);
        Assert.Contains("postgres", supported);
        Assert.Contains("sharepoint", supported);
        Assert.Contains("mock", supported);
    }

    [Fact]
    public void Selection_ExposesLowerCaseNameForDiagnostics()
    {
        Assert.Equal("sharepoint", new PlanningStoreSelection(PlanningStoreProvider.SharePoint).Name);
        Assert.Equal("postgres", new PlanningStoreSelection(PlanningStoreProvider.Postgres).Name);
    }

    [Fact]
    public void Selection_IsRelational_ForSqlAndPostgresOnly()
    {
        Assert.True(new PlanningStoreSelection(PlanningStoreProvider.Sql).IsRelational);
        Assert.True(new PlanningStoreSelection(PlanningStoreProvider.Postgres).IsRelational);
        Assert.False(new PlanningStoreSelection(PlanningStoreProvider.SharePoint).IsRelational);
        Assert.False(new PlanningStoreSelection(PlanningStoreProvider.Mock).IsRelational);
    }
}
