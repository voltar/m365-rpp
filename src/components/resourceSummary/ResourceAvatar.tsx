import { useEffect, useState } from "react";
import { Avatar } from "@fluentui/react-components";
import type { ResourceSummary } from "../../models/resource";
import { getUserPhotoObjectUrl } from "../../services/userPhotoService";

interface ResourceAvatarProps {
  readonly resource: ResourceSummary;
}

export function ResourceAvatar({ resource }: ResourceAvatarProps) {
  // EO-421: real profile photo when available; initials stay the fallback.
  const [photoUrl, setPhotoUrl] = useState<string>();

  useEffect(() => {
    let isActive = true;

    getUserPhotoObjectUrl(resource.id).then((url) => {
      if (isActive) {
        setPhotoUrl(url);
      }
    });

    return () => {
      isActive = false;
    };
  }, [resource.id]);

  return (
    <Avatar
      name={resource.displayName}
      initials={resource.initials}
      image={photoUrl ? { src: photoUrl } : undefined}
      color="colorful"
      size={32}
    />
  );
}
