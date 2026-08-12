# syntax=docker/dockerfile:1
#
# Build context must be the repository root (not RppWebApi/), so EO-427
# release.json is available for assembly versioning:
#   docker compose -f docker-compose.api.yml build
#   docker build -f RppWebApi/Dockerfile .

# Build stage: uses full .NET SDK for restore/build/publish.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# EO-427: RppWebApi.csproj reads ../release.json relative to the project directory.
COPY release.json ./
COPY RppWebApi/RppWebApi.csproj RppWebApi/

RUN dotnet restore ./RppWebApi/RppWebApi.csproj

# Copy API sources only (root .dockerignore keeps the context lean).
COPY RppWebApi/ RppWebApi/
RUN dotnet publish ./RppWebApi/RppWebApi.csproj -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage: smaller image with ASP.NET runtime only.
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "RppWebApi.dll"]
