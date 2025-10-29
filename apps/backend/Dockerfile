# syntax=docker/dockerfile:1

FROM maven:3.9.6-eclipse-temurin-21 AS build

# Force Maven to use TLSv1.2 during dependency resolution to avoid
# handshake issues against mirrors that do not support TLSv1.3 yet.
ENV MAVEN_OPTS="-Dhttps.protocols=TLSv1.2 -Djdk.tls.client.protocols=TLSv1.2"
WORKDIR /workspace
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /workspace/target/hub-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
