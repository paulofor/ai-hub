package com.aihub.hub.service;

import com.aihub.hub.domain.video.VideoAsset;
import com.aihub.hub.domain.video.VideoProject;
import com.aihub.hub.domain.video.VideoRenderJob;
import com.aihub.hub.domain.video.VideoScene;
import com.aihub.hub.dto.video.CreateVideoProjectRequest;
import com.aihub.hub.dto.video.VideoProjectView;
import com.aihub.hub.dto.video.VideoProjectView.AssetView;
import com.aihub.hub.dto.video.VideoProjectView.RenderJobView;
import com.aihub.hub.dto.video.VideoProjectView.SceneView;
import com.aihub.hub.repository.video.VideoAssetRepository;
import com.aihub.hub.repository.video.VideoProjectRepository;
import com.aihub.hub.repository.video.VideoRenderJobRepository;
import com.aihub.hub.repository.video.VideoSceneRepository;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
@Transactional
public class VideoProjectService {

    private final VideoProjectRepository projectRepository;
    private final VideoSceneRepository sceneRepository;
    private final VideoAssetRepository assetRepository;
    private final VideoRenderJobRepository renderJobRepository;

    public VideoProjectService(VideoProjectRepository projectRepository,
                               VideoSceneRepository sceneRepository,
                               VideoAssetRepository assetRepository,
                               VideoRenderJobRepository renderJobRepository) {
        this.projectRepository = projectRepository;
        this.sceneRepository = sceneRepository;
        this.assetRepository = assetRepository;
        this.renderJobRepository = renderJobRepository;
    }

    @Transactional(readOnly = true)
    public List<VideoProjectView> listProjects() {
        List<VideoProject> projects = projectRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt"));
        return buildViews(projects);
    }

    @Transactional(readOnly = true)
    public Optional<VideoProjectView> getProject(Long id) {
        return projectRepository.findById(id).map(project -> buildViews(List.of(project)).stream().findFirst().orElse(null));
    }

    public VideoProjectView createProject(String actor, CreateVideoProjectRequest request) {
        Objects.requireNonNull(actor, "actor é obrigatório");
        validateUniqueCode(request.getCode());

        VideoProject project = new VideoProject();
        project.setCode(request.getCode());
        project.setTitle(request.getTitle());
        project.setDescription(request.getDescription());
        project.setProductName(request.getProductName());
        project.setStatus(defaultIfBlank(request.getStatus(), "draft"));
        project.setLanguage(defaultIfBlank(request.getLanguage(), "pt-BR"));
        project.setTone(request.getTone());
        project.setTargetAudience(request.getTargetAudience());
        project.setPrimaryGoal(request.getPrimaryGoal());
        project.setCallToActionUrl(request.getCallToActionUrl());
        project.setAvatarStyle(request.getAvatarStyle());
        project.setHeroImageUrl(request.getHeroImageUrl());
        project.setOwnerEmail(actor);

        final VideoProject persisted = projectRepository.save(project);

        if (request.getScenes() != null) {
            List<VideoScene> scenes = request.getScenes().stream()
                .map(sceneInput -> {
                    VideoScene scene = new VideoScene();
                    scene.setProject(persisted);
                    scene.setSequenceIndex(sceneInput.getSequenceIndex());
                    scene.setTitle(sceneInput.getTitle());
                    scene.setScript(sceneInput.getScript());
                    scene.setVisualStyle(sceneInput.getVisualStyle());
                    scene.setVoiceoverUrl(sceneInput.getVoiceoverUrl());
                    scene.setDurationSeconds(sceneInput.getDurationSeconds());
                    scene.setCallToActionLabel(sceneInput.getCallToActionLabel());
                    scene.setPrimaryAssetUrl(sceneInput.getPrimaryAssetUrl());
                    return scene;
                })
                .toList();
            sceneRepository.saveAll(scenes);
        }

        if (request.getAssets() != null) {
            List<VideoAsset> assets = request.getAssets().stream()
                .map(assetInput -> {
                    VideoAsset asset = new VideoAsset();
                    asset.setProject(persisted);
                    asset.setType(assetInput.getType());
                    asset.setLabel(assetInput.getLabel());
                    asset.setSource(assetInput.getSource());
                    asset.setDescription(assetInput.getDescription());
                    return asset;
                })
                .toList();
            assetRepository.saveAll(assets);
        }

        return getProject(persisted.getId()).orElseThrow(() -> new IllegalStateException("Projeto de vídeo não encontrado após criação"));
    }

    private void validateUniqueCode(String code) {
        if (projectRepository.findByCode(code).isPresent()) {
            throw new IllegalStateException("Código de projeto já está em uso: " + code);
        }
    }

    private List<VideoProjectView> buildViews(List<VideoProject> projects) {
        if (projects.isEmpty()) {
            return List.of();
        }

        List<Long> projectIds = projects.stream().map(VideoProject::getId).toList();

        Map<Long, List<VideoScene>> scenesByProject = sceneRepository.findByProjectIdIn(projectIds).stream()
            .collect(Collectors.groupingBy(scene -> scene.getProject().getId()));

        Map<Long, List<VideoAsset>> assetsByProject = assetRepository.findByProjectIdIn(projectIds).stream()
            .collect(Collectors.groupingBy(asset -> asset.getProject().getId()));

        Map<Long, VideoRenderJob> latestRenderJobByProject = renderJobRepository.findByProjectIdIn(projectIds).stream()
            .collect(HashMap::new,
                (map, job) -> {
                    Long projectId = job.getProject().getId();
                    VideoRenderJob existing = map.get(projectId);
                    if (existing == null || isAfter(job.getRequestedAt(), existing.getRequestedAt())) {
                        map.put(projectId, job);
                    }
                },
                HashMap::putAll);

        List<VideoProjectView> views = new ArrayList<>(projects.size());
        for (VideoProject current : projects) {
            List<SceneView> sceneViews = scenesByProject.getOrDefault(current.getId(), List.of()).stream()
                .sorted(Comparator
                    .comparing(VideoScene::getSequenceIndex)
                    .thenComparing(VideoScene::getId))
                .map(scene -> new SceneView(
                    scene.getId(),
                    scene.getSequenceIndex(),
                    scene.getTitle(),
                    scene.getScript(),
                    scene.getVisualStyle(),
                    scene.getVoiceoverUrl(),
                    scene.getDurationSeconds(),
                    scene.getCallToActionLabel(),
                    scene.getPrimaryAssetUrl(),
                    scene.getCreatedAt(),
                    scene.getUpdatedAt()
                ))
                .toList();

            List<AssetView> assetViews = assetsByProject.getOrDefault(current.getId(), List.of()).stream()
                .sorted(Comparator
                    .comparing(VideoAsset::getType)
                    .thenComparing(VideoAsset::getLabel)
                    .thenComparing(VideoAsset::getId))
                .map(asset -> new AssetView(
                    asset.getId(),
                    asset.getType(),
                    asset.getLabel(),
                    asset.getSource(),
                    asset.getDescription(),
                    asset.getCreatedAt()
                ))
                .toList();

            VideoRenderJob latestJob = latestRenderJobByProject.get(current.getId());
            RenderJobView renderView = null;
            if (latestJob != null) {
                renderView = new RenderJobView(
                    latestJob.getId(),
                    latestJob.getProvider(),
                    latestJob.getProviderJobId(),
                    latestJob.getStatus(),
                    latestJob.getRenderProfile(),
                    latestJob.getRequestedAt(),
                    latestJob.getStartedAt(),
                    latestJob.getFinishedAt(),
                    latestJob.getOutputUrl(),
                    latestJob.getFailureReason()
                );
            }

            views.add(new VideoProjectView(
                current.getId(),
                current.getCode(),
                current.getTitle(),
                current.getDescription(),
                current.getProductName(),
                current.getStatus(),
                current.getLanguage(),
                current.getTone(),
                current.getTargetAudience(),
                current.getPrimaryGoal(),
                current.getCallToActionUrl(),
                current.getAvatarStyle(),
                current.getHeroImageUrl(),
                current.getOwnerEmail(),
                current.getLastSyncedAt(),
                current.getCreatedAt(),
                current.getUpdatedAt(),
                sceneViews,
                assetViews,
                renderView
            ));
        }

        return views;
    }

    private String defaultIfBlank(String value, String defaultValue) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return value;
    }

    private boolean isAfter(Instant candidate, Instant reference) {
        if (candidate == null) {
            return false;
        }
        if (reference == null) {
            return true;
        }
        return candidate.isAfter(reference);
    }
}
