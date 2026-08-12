using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RppWebApi.Controllers;
using RppWebApi.Models;
using RppWebApi.Services;
using Xunit;

namespace RppWebApi.Tests;

/// <summary>
/// EO-450 FR-450.4/FR-450.7: the help endpoint is strictly read-only and rejects
/// malformed input before reaching the assistant.
/// </summary>
public class HelpControllerTests
{
    [Fact]
    public async Task Chat_ReturnsBadRequest_WhenQuestionIsEmpty()
    {
        var assistant = new RecordingHelpAssistantService();
        var controller = CreateController(assistant);

        var result = await controller.Chat(new HelpChatRequestDto { Question = "   " }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.False(assistant.WasCalled);
    }

    [Fact]
    public async Task Chat_ReturnsBadRequest_WhenQuestionExceedsMaxLength()
    {
        var assistant = new RecordingHelpAssistantService();
        var controller = CreateController(assistant, new HelpAssistantSettings { MaxQuestionLength = 10 });

        var result = await controller.Chat(
            new HelpChatRequestDto { Question = new string('a', 11) },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.False(assistant.WasCalled);
    }

    [Fact]
    public async Task Chat_ForwardsPageContextToTheAssistant()
    {
        var assistant = new RecordingHelpAssistantService();
        var controller = CreateController(assistant);

        var result = await controller.Chat(
            new HelpChatRequestDto
            {
                Question = "Weshalb ist das hier rot?",
                Context = new HelpChatContextDto
                {
                    Language = "de-CH",
                    CurrentPage = "teamCapacity",
                    UserRole = "teamLead"
                }
            },
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("teamCapacity", assistant.LastRequest?.Context?.CurrentPage);
        Assert.Equal("de-CH", assistant.LastRequest?.Context?.Language);
    }

    [Fact]
    public async Task Chat_ReturnsServiceUnavailable_WhenTheAssistantIsUnreachable()
    {
        var assistant = new ThrowingHelpAssistantService();
        var controller = CreateController(assistant);

        var result = await controller.Chat(
            new HelpChatRequestDto { Question = "Wie erfasse ich eine halbtägige Abwesenheit?" },
            CancellationToken.None);

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, statusResult.StatusCode);
    }

    [Fact]
    public void Feedback_ReturnsBadRequest_ForAnUnknownRating()
    {
        var controller = CreateController(new RecordingHelpAssistantService());

        var result = controller.Feedback(new HelpFeedbackRequestDto
        {
            MessageId = "assistant-1",
            Rating = "sideways"
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Theory]
    [InlineData("helpful")]
    [InlineData("notHelpful")]
    public void Feedback_ReturnsNoContent_ForAcceptedRatings(string rating)
    {
        var controller = CreateController(new RecordingHelpAssistantService());

        var result = controller.Feedback(new HelpFeedbackRequestDto
        {
            MessageId = "assistant-1",
            Rating = rating
        });

        Assert.IsType<NoContentResult>(result);
    }

    /// <summary>
    /// EO-450 §8 step 3 is outstanding until the Foundry resource exists. Until then the
    /// fallback must answer honestly instead of inventing application behaviour.
    /// </summary>
    [Fact]
    public async Task FallbackAssistant_ReportsThatItCannotAnswer()
    {
        var assistant = new FallbackHelpAssistantService(NullLogger<FallbackHelpAssistantService>.Instance);

        var answer = await assistant.AskAsync(
            new HelpChatRequestDto
            {
                Question = "Welche Datenbank verwendet RPP?",
                Context = new HelpChatContextDto { Language = "de-CH" }
            },
            userObjectId: "user-1",
            CancellationToken.None);

        Assert.True(answer.Unanswered);
        Assert.Empty(answer.Sources);
    }

    [Fact]
    public void Settings_AreOnlyConsideredConfigured_WhenEndpointAndAgentAreBothSet()
    {
        Assert.False(new HelpAssistantSettings().IsConfigured);
        Assert.False(new HelpAssistantSettings { ProjectEndpoint = "https://example.invalid" }.IsConfigured);
        Assert.False(new HelpAssistantSettings { AgentName = "rpp-help-assistant" }.IsConfigured);
        Assert.True(new HelpAssistantSettings
        {
            ProjectEndpoint = "https://example.invalid",
            AgentName = "rpp-help-assistant"
        }.IsConfigured);
    }

    private static HelpController CreateController(
        IHelpAssistantService assistant,
        HelpAssistantSettings? settings = null)
    {
        return new HelpController(
            assistant,
            Options.Create(settings ?? new HelpAssistantSettings()),
            NullLogger<HelpController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };
    }

    private sealed class RecordingHelpAssistantService : IHelpAssistantService
    {
        public bool WasCalled { get; private set; }

        public HelpChatRequestDto? LastRequest { get; private set; }

        public Task<HelpChatAnswerDto> AskAsync(
            HelpChatRequestDto request,
            string? userObjectId,
            CancellationToken cancellationToken)
        {
            WasCalled = true;
            LastRequest = request;

            return Task.FromResult(new HelpChatAnswerDto { Content = "answer" });
        }
    }

    private sealed class ThrowingHelpAssistantService : IHelpAssistantService
    {
        public Task<HelpChatAnswerDto> AskAsync(
            HelpChatRequestDto request,
            string? userObjectId,
            CancellationToken cancellationToken)
            => throw new HelpAssistantUnavailableException("unreachable");
    }
}
